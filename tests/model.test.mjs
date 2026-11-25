import test from "node:test";
import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import {
  decodeBencode,
  inspectTorrent,
  inspectMagnet,
  formatBytes,
  demoTorrent,
  reportText,
} from "../web/model.mjs";
if (!globalThis.crypto) globalThis.crypto = webcrypto;
const enc = (value) => {
  if (Buffer.isBuffer(value) || value instanceof Uint8Array)
    return Buffer.concat([Buffer.from(`${value.length}:`), Buffer.from(value)]);
  if (typeof value === "string") return enc(Buffer.from(value));
  if (typeof value === "number" || typeof value === "bigint")
    return Buffer.from(`i${value}e`);
  if (Array.isArray(value))
    return Buffer.concat([
      Buffer.from("l"),
      ...value.map(enc),
      Buffer.from("e"),
    ]);
  return Buffer.concat([
    Buffer.from("d"),
    ...Object.keys(value)
      .sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)))
      .flatMap((k) => [enc(k), enc(value[k])]),
    Buffer.from("e"),
  ]);
};
const v1 = (changes = {}) => ({
  length: 1024,
  name: "readme.txt",
  "piece length": 16384,
  pieces: Buffer.alloc(20, 3),
  ...changes,
});
const file = (path, length = 2) => ({ path, length });
test("hashes the exact info bytes and lists a single payload", async () => {
  const info = v1(),
    r = await inspectTorrent(
      enc({ announce: "https://example.org/announce", info }),
    );
  assert.equal(
    r.hashes.sha1,
    createHash("sha1").update(enc(info)).digest("hex"),
  );
  assert.equal(r.totalBytes, "1024");
  assert.equal(r.files[0].path, "readme.txt");
  assert.equal(r.trackers[0].host, "example.org");
  assert.equal(r.private, false);
  assert.equal(r.warnings.length, 0);
});
test("local demonstration is a valid inspectable metadata file", async () => {
  assert.equal(
    (await inspectTorrent(demoTorrent())).files[0].path,
    "readme.txt",
  );
});
test("rejects trailing bytes, truncation, invalid integers and dictionary keys", () => {
  for (const text of [
    "d4:infodex",
    "d1:ai03ee",
    "d1:ai-0ee",
    "d1:ai+1ee",
    "d1:b1:x1:a1:ye",
    "d1:a1:x1:a1:ye",
    "d1:a99999:x",
    "d1:a01:xe",
    "d1:al",
  ])
    assert.throws(() => decodeBencode(Buffer.from(text)));
});
test("bounded bytes, recursion, metadata nodes and file count", async () => {
  assert.throws(
    () => decodeBencode(Buffer.from("de"), { maxBytes: 1 }),
    /exceeds/,
  );
  assert.throws(
    () => decodeBencode(Buffer.from("d1:alllee"), { maxDepth: 1 }),
    /deep/,
  );
  assert.throws(
    () => decodeBencode(enc({ a: "b", c: "d" }), { maxNodes: 2 }),
    /entries/,
  );
  const info = v1();
  delete info.length;
  info.files = [file(["a"]), file(["b"])];
  await assert.rejects(
    () => inspectTorrent(enc({ info }), { maxFiles: 1 }),
    /Too many files/,
  );
});
test("detects dangerous, ambiguous, bidi, duplicate and executable paths", async () => {
  const info = v1({ name: "bundle" });
  delete info.length;
  info.files = [
    file(["..", "photo.jpg.exe"]),
    file(["safe.txt"]),
    file(["SAFE.txt"]),
    file(["report\u202Etxt.exe"]),
    file(["C:\\escape"]),
    file(["CON"]),
  ];
  const r = await inspectTorrent(enc({ info }));
  assert.equal(r.flaggedFiles, 5);
  assert.ok(r.files[0].flags.some((s) => s.includes("Unsafe")));
  assert.ok(r.files[0].flags.some((s) => s.includes("Double")));
  assert.ok(r.files[2].flags.some((s) => s.includes("colliding")));
  assert.ok(r.files[3].flags.some((s) => s.includes("Bidirectional")));
  assert.ok(r.files[5].flags.some((s) => s.includes("Windows")));
});
test("large sizes remain exact and disagreeing piece counts are reported", async () => {
  const r = await inspectTorrent(
    enc({ info: v1({ length: 9007199254740993n }) }),
  );
  assert.equal(r.totalBytes, "9007199254740993");
  assert.ok(r.warnings.some((s) => s.includes("Piece count")));
  assert.doesNotThrow(() => JSON.parse(reportText(r)));
});
test("padding is separate from payload and private flag is explicit", async () => {
  const info = v1({ private: 1, name: "bundle" });
  delete info.length;
  info.files = [file(["a"], 2), { ...file([".pad"], 16382), attr: "p" }];
  const r = await inspectTorrent(enc({ info }));
  assert.equal(r.totalBytes, "2");
  assert.equal(r.paddingBytes, "16382");
  assert.equal(r.private, true);
});
test("v2 and hybrid compute SHA-256 and SHA-1 separately", async () => {
  const info = {
    "file tree": {
      "a.txt": { "": { length: 2, "pieces root": Buffer.alloc(32, 1) } },
    },
    "meta version": 2,
    name: "a.txt",
    "piece length": 16384,
  };
  const r = await inspectTorrent(enc({ info }));
  assert.equal(r.format, "BitTorrent v2");
  assert.equal(r.files[0].path, "a.txt");
  assert.equal(
    r.hashes.sha256,
    createHash("sha256").update(enc(info)).digest("hex"),
  );
  assert.ok(!r.hashes.sha1);
  const hybrid = { ...info, pieces: Buffer.alloc(20, 3), length: 2 };
  assert.equal(
    (await inspectTorrent(enc({ info: hybrid }))).format,
    "Hybrid v1 + v2",
  );
});
test("v2 validates supported version, non-root leaves and piece length", async () => {
  for (const info of [
    v1({ "meta version": 3 }),
    {
      "meta version": 2,
      name: "x",
      "piece length": 8192,
      "file tree": { x: { "": { length: 0 } } },
    },
    {
      "meta version": 2,
      name: "x",
      "piece length": 16384,
      "file tree": { "": { length: 0 } },
    },
  ])
    await assert.rejects(() => inspectTorrent(enc({ info })));
});
test("raw UTF-8 names render as text and invalid UTF-8 is flagged", async () => {
  const text = "<img src=x onerror=alert(1)>";
  const r = await inspectTorrent(enc({ info: v1({ name: text }) }));
  assert.equal(r.name, text);
  const broken = await inspectTorrent(
    enc({ info: v1({ name: Buffer.from([0xff]) }) }),
  );
  assert.ok(broken.warnings.some((s) => s.includes("UTF-8")));
});
test("dictionary keys cannot mutate prototypes", () => {
  const root = decodeBencode(Buffer.from("d9:__proto__d1:x1:yee"));
  assert.equal(root.type, "dict");
  assert.equal({}.x, undefined);
});
test("magnet parses hex and base32 v1 hashes without inventing files", () => {
  const hash = "0123456789abcdef0123456789abcdef01234567",
    r = inspectMagnet(
      `magnet:?xt=urn:btih:${hash}&dn=movie.mp4&xl=123&tr=udp%3A%2F%2Ftracker.example%3A80`,
    );
  assert.equal(r.hashes.sha1, hash);
  assert.deepEqual(r.files, []);
  assert.equal(r.totalBytes, "123");
  assert.equal(r.private, null);
  assert.equal(r.trackers[0].host, "tracker.example");
  assert.equal(
    inspectMagnet("magnet:?xt=urn:btih:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA").hashes
      .sha1,
    "0".repeat(40),
  );
});
test("magnet supports v2 multihashes and rejects conflicts", () => {
  const r = inspectMagnet("magnet:?xt=urn:btmh:1220" + "a".repeat(64));
  assert.equal(r.hashes.sha256, "a".repeat(64));
  assert.throws(() => inspectMagnet("https://example.org"));
  assert.throws(() => inspectMagnet("magnet:?xt=urn:btih:bad"));
  assert.throws(
    () =>
      inspectMagnet(
        "magnet:?xt=urn:btih:" +
          "a".repeat(40) +
          "&xt=urn:btih:" +
          "b".repeat(40),
      ),
    /conflicting/,
  );
});
test("unsupported tracker protocol stays inert and malformed size is ignored", () => {
  const r = inspectMagnet(
    "magnet:?xt=urn:btih:" + "a".repeat(40) + "&tr=javascript:alert(1)&xl=-4",
  );
  assert.equal(r.trackers[0].scheme, "unknown");
  assert.equal(r.totalBytes, null);
});
test("file formatting has correct binary units", () => {
  assert.equal(formatBytes(0), "0 B");
  assert.equal(formatBytes(1536), "1.5 KiB");
});
