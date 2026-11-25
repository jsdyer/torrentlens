import { config } from "./config.mjs";
const utf8 = new TextDecoder("utf-8");
const strictUtf8 = new TextDecoder("utf-8", { fatal: true });
const encoder = new TextEncoder();
const asText = (n) => (n?.type === "bytes" ? utf8.decode(n.value) : "");
const get = (n, k) =>
  n?.type === "dict"
    ? n.value.find(([key]) => asText(key) === k)?.[1]
    : undefined;
const has = (n, k) => get(n, k) !== undefined;
const hex = (bytes) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
const compare = (a, b) => {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return a.length - b.length;
};
export function decodeBencode(input, options = {}) {
  const limits = { ...config, ...options };
  if (!(input instanceof Uint8Array))
    throw new TypeError("Expected torrent bytes.");
  if (!input.length) throw new Error("The file is empty.");
  if (input.length > limits.maxBytes)
    throw new Error(
      `File exceeds the ${formatBytes(BigInt(limits.maxBytes))} local inspection limit.`,
    );
  let pos = 0,
    nodes = 0;
  function parse(depth) {
    if (depth > limits.maxDepth)
      throw new Error("Torrent nesting is too deep.");
    if (++nodes > limits.maxNodes)
      throw new Error("Torrent contains too many metadata entries.");
    const start = pos,
      c = input[pos];
    if (c === undefined) throw new Error("Unexpected end of torrent file.");
    if (c >= 48 && c <= 57) {
      let end = pos;
      while (end < input.length && input[end] >= 48 && input[end] <= 57) end++;
      if (input[end] !== 58) throw new Error("Invalid byte-string length.");
      const digits = utf8.decode(input.subarray(pos, end));
      if (digits.length > 9 || !/^(0|[1-9][0-9]*)$/.test(digits))
        throw new Error("Non-canonical or excessive byte-string length.");
      const length = Number(digits);
      pos = end + 1;
      if (length > input.length - pos)
        throw new Error("Byte string extends beyond the file.");
      const value = input.subarray(pos, pos + length);
      pos += length;
      return { type: "bytes", value, start, end: pos };
    }
    if (c === 105) {
      pos++;
      let end = pos;
      while (end < input.length && input[end] !== 101 && end - pos <= 100)
        end++;
      if (input[end] !== 101)
        throw new Error("Unterminated or excessive integer.");
      const str = utf8.decode(input.subarray(pos, end));
      if (!/^(0|-?[1-9][0-9]*)$/.test(str))
        throw new Error("Non-canonical integer.");
      pos = end + 1;
      return { type: "int", value: BigInt(str), start, end: pos };
    }
    if (c === 108 || c === 100) {
      const type = c === 108 ? "list" : "dict";
      pos++;
      const value = [];
      let previous = null;
      while (input[pos] !== 101) {
        if (pos >= input.length) throw new Error("Unterminated collection.");
        if (type === "list") value.push(parse(depth + 1));
        else {
          const key = parse(depth + 1);
          if (key.type !== "bytes")
            throw new Error("Dictionary key is not a byte string.");
          if (previous && compare(previous, key.value) >= 0)
            throw new Error(
              "Dictionary keys are duplicated or not in byte order.",
            );
          previous = key.value;
          value.push([key, parse(depth + 1)]);
        }
      }
      pos++;
      return { type, value, start, end: pos };
    }
    throw new Error(`Invalid bencode marker at byte ${pos}.`);
  }
  const root = parse(0);
  if (pos !== input.length)
    throw new Error("Unexpected data after the torrent dictionary.");
  if (root.type !== "dict")
    throw new Error("A torrent must have a top-level dictionary.");
  return root;
}
function lengthOf(n, label) {
  if (n?.type !== "int" || n.value < 0n)
    throw new Error(`Invalid ${label}: expected a nonnegative integer.`);
  return n.value;
}
function textOf(n, label) {
  if (n?.type !== "bytes") throw new Error(`Missing or invalid ${label}.`);
  return asText(n);
}
function fileFlags(parts, attributes = "") {
  const warnings = [];
  const path = parts.join("/"),
    name = parts.at(-1) || "";
  if (
    parts.some(
      (p) =>
        !p ||
        p === "." ||
        p === ".." ||
        /[\\/\x00-\x1f\x7f]/.test(p) ||
        /^[A-Za-z]:/.test(p),
    )
  )
    warnings.push("Unsafe or ambiguous path component");
  if (parts.some((p) => /[\u202a-\u202e\u2066-\u2069]/.test(p)))
    warnings.push("Bidirectional text control in filename");
  if (
    parts.some(
      (p) =>
        /[ .]$/.test(p) ||
        /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p),
    )
  )
    warnings.push("Filename may conflict on Windows");
  if (
    /\.(exe|com|scr|bat|cmd|ps1|vbs|vbe|js|jse|msi|msp|hta|sh|desktop|app|dmg|pkg|jar|apk)$/i.test(
      name,
    )
  )
    warnings.push("Executable, installer or script");
  if (/\.(pdf|txt|jpg|jpeg|png|mp4|mkv|avi|mp3|docx?)\.[^.]+$/i.test(name))
    warnings.push("Double extension; inspect the final extension");
  if (attributes.includes("l")) warnings.push("Symbolic-link entry");
  if (/\uFFFD/.test(path))
    warnings.push("Invalid or replacement UTF-8 in filename");
  return warnings;
}
function validUtf8(n) {
  try {
    strictUtf8.decode(n.value);
    return true;
  } catch {
    return false;
  }
}
function tracker(value) {
  const raw = String(value);
  try {
    const url = new URL(raw);
    if (
      !["http:", "https:", "udp:", "ws:", "wss:"].includes(url.protocol) ||
      !url.hostname
    )
      throw new Error();
    return {
      url: raw,
      host: url.hostname,
      scheme: url.protocol.slice(0, -1),
      warning:
        url.username || url.password
          ? "Contains credentials; do not share this URL."
          : "",
    };
  } catch {
    return {
      url: raw,
      host: "Unrecognized tracker address",
      scheme: "unknown",
      warning: "Invalid or unsupported tracker URL",
    };
  }
}
function trackerList(root) {
  const urls = [];
  const announce = asText(get(root, "announce"));
  if (announce) urls.push(announce);
  const tiers = get(root, "announce-list");
  if (tiers?.type === "list")
    for (const tier of tiers.value) {
      if (tier.type === "list")
        for (const t of tier.value)
          if (t.type === "bytes") urls.push(asText(t));
    }
  return [...new Set(urls)].map(tracker);
}
export async function inspectTorrent(input, options = {}) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const root = decodeBencode(bytes, options),
    info = get(root, "info");
  if (info?.type !== "dict") throw new Error("Missing info dictionary.");
  const meta = get(info, "meta version");
  if (meta && (meta.type !== "int" || meta.value !== 2n))
    throw new Error("Unsupported torrent metadata version.");
  const isV2 = !!meta,
    isV1 = !isV2 || has(info, "pieces");
  const name = textOf(
    get(info, "name.utf-8") || get(info, "name"),
    "torrent name",
  );
  if (!name) throw new Error("Torrent name is empty.");
  const pieceLength = lengthOf(get(info, "piece length"), "piece length");
  if (pieceLength === 0n)
    throw new Error("Piece length must be greater than zero.");
  if (
    isV2 &&
    (pieceLength < 16384n || (pieceLength & (pieceLength - 1n)) !== 0n)
  )
    throw new Error("V2 piece length must be a power of two, at least 16 KiB.");
  const maxFiles = options.maxFiles ?? config.maxFiles;
  const filesV1 = [],
    filesV2 = [],
    warnings = [];
  function add(list, parts, size, attr = "", invalid = false) {
    if (list.length >= maxFiles)
      throw new Error("Too many files for local inspection.");
    const flags = fileFlags(parts, attr);
    if (invalid && !flags.includes("Invalid or replacement UTF-8 in filename"))
      flags.push("Invalid or replacement UTF-8 in filename");
    list.push({
      path: parts.join("/"),
      size: size.toString(),
      flags,
      padding: attr.includes("p"),
      symlink: attr.includes("l"),
    });
  }
  if (isV1) {
    const pieces = get(info, "pieces");
    if (pieces?.type !== "bytes" || pieces.value.length % 20 !== 0)
      throw new Error(
        "V1 pieces must be a byte string containing complete SHA-1 hashes.",
      );
    const entries = get(info, "files");
    if (entries) {
      if (
        entries.type !== "list" ||
        has(info, "length") ||
        !entries.value.length
      )
        throw new Error("Invalid v1 file list.");
      for (const file of entries.value) {
        const path = get(file, "path.utf-8") || get(file, "path");
        if (
          path?.type !== "list" ||
          !path.value.length ||
          path.value.some((p) => p.type !== "bytes")
        )
          throw new Error("Invalid file path list.");
        add(
          filesV1,
          [name, ...path.value.map(asText)],
          lengthOf(get(file, "length"), "file size"),
          asText(get(file, "attr")),
          path.value.some((p) => !validUtf8(p)),
        );
      }
    } else
      add(
        filesV1,
        [name],
        lengthOf(get(info, "length"), "file size"),
        asText(get(info, "attr")),
      );
    const size = filesV1.reduce((sum, f) => sum + BigInt(f.size), 0n),
      expected = (size + pieceLength - 1n) / pieceLength;
    if (BigInt(pieces.value.length / 20) !== expected)
      warnings.push(
        `Piece count does not match the listed payload size (${pieces.value.length / 20} supplied; ${expected} expected).`,
      );
  }
  if (isV2) {
    const tree = get(info, "file tree");
    if (tree?.type !== "dict" || !tree.value.length)
      throw new Error("Missing v2 file tree.");
    function walk(node, parts, invalid = false) {
      if (node?.type !== "dict") throw new Error("Invalid v2 file-tree node.");
      const leaf = get(node, "");
      if (leaf) {
        if (!parts.length || node.value.length !== 1 || leaf.type !== "dict")
          throw new Error("Invalid v2 file-tree leaf.");
        const size = lengthOf(get(leaf, "length"), "file size"),
          piecesRoot = get(leaf, "pieces root");
        if (
          size > 0n &&
          (piecesRoot?.type !== "bytes" || piecesRoot.value.length !== 32)
        )
          warnings.push(`Missing or invalid pieces root: ${parts.join("/")}`);
        add(filesV2, parts, size, asText(get(leaf, "attr")), invalid);
      } else
        for (const [key, value] of node.value)
          walk(value, [...parts, asText(key)], invalid || !validUtf8(key));
    }
    walk(tree, []);
    if (!filesV2.length) throw new Error("V2 tree contains no files.");
    warnings.push(
      "V2 piece layers and file content are not cryptographically verified by this metadata inspector.",
    );
    if (isV1) {
      const a = filesV1.filter((f) => !f.padding),
        b = filesV2.filter((f) => !f.padding);
      if (
        a.length !== b.length ||
        a.reduce((s, f) => s + BigInt(f.size), 0n) !==
          b.reduce((s, f) => s + BigInt(f.size), 0n)
      )
        warnings.push(
          "The hybrid v1 and v2 file layouts have different counts or total sizes.",
        );
    }
  }
  const files = isV2 ? filesV2 : filesV1,
    seen = new Set();
  for (const f of files) {
    const canonical = f.path.normalize("NFC").toLowerCase();
    if (seen.has(canonical)) f.flags.push("Duplicate or case-colliding path");
    seen.add(canonical);
  }
  if (fileFlags([name]).length)
    warnings.push(
      "The torrent display name has a potentially unsafe filename form.",
    );
  if (!validUtf8(get(info, "name.utf-8") || get(info, "name")))
    warnings.push("Torrent display name contains invalid UTF-8.");
  const payload = files
      .filter((f) => !f.padding)
      .reduce((s, f) => s + BigInt(f.size), 0n),
    padding = files
      .filter((f) => f.padding)
      .reduce((s, f) => s + BigInt(f.size), 0n);
  const raw = bytes.subarray(info.start, info.end),
    hashes = {};
  if (!globalThis.crypto?.subtle)
    throw new Error("Hashing requires an HTTPS page or localhost.");
  if (isV1)
    hashes.sha1 = hex(new Uint8Array(await crypto.subtle.digest("SHA-1", raw)));
  if (isV2)
    hashes.sha256 = hex(
      new Uint8Array(await crypto.subtle.digest("SHA-256", raw)),
    );
  const created = get(root, "creation date");
  let creationDate = null;
  if (
    created?.type === "int" &&
    created.value >= 0n &&
    created.value <= 253402300799n
  )
    creationDate = new Date(Number(created.value) * 1000).toISOString();
  return {
    kind: "torrent",
    name,
    format: isV2
      ? isV1
        ? "Hybrid v1 + v2"
        : "BitTorrent v2"
      : "BitTorrent v1",
    hashes,
    files,
    totalBytes: payload.toString(),
    paddingBytes: padding.toString(),
    pieceLength: pieceLength.toString(),
    private: get(info, "private")?.value === 1n,
    trackers: trackerList(root),
    webSeeds: (() => {
      const n = get(root, "url-list");
      return n?.type === "bytes"
        ? [asText(n)]
        : n?.type === "list"
          ? n.value.filter((v) => v.type === "bytes").map(asText)
          : [];
    })(),
    createdBy: asText(get(root, "created by")),
    creationDate,
    comment: asText(get(root, "comment")),
    warnings,
    flaggedFiles: files.filter((f) => f.flags.length).length,
    metadataBytes: bytes.length,
  };
}
function base32(s) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0,
    value = 0;
  const output = [];
  for (const c of s.toUpperCase()) {
    const v = alphabet.indexOf(c);
    if (v < 0) throw new Error("Invalid base32 infohash.");
    value = (value << 5) | v;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      output.push((value >>> bits) & 255);
    }
  }
  return hex(output);
}
export function inspectMagnet(value, options = {}) {
  if (typeof value !== "string") throw new TypeError("Paste a magnet link.");
  if (value.length > (options.maxMagnetLength ?? config.maxMagnetLength))
    throw new Error("Magnet link is too long.");
  const text = value.trim();
  if (!/^magnet:\?/i.test(text))
    throw new Error("Enter a magnet link beginning with magnet:?.");
  const params = new URLSearchParams(text.slice(text.indexOf("?") + 1)),
    hashes = {},
    warnings = [];
  for (const xt of params.getAll("xt")) {
    let key, hash;
    const m = xt.match(/^urn:btih:([a-f0-9]{40}|[a-z2-7]{32})$/i),
      v2 = xt.match(/^urn:btmh:1220([a-f0-9]{64})$/i);
    if (m) {
      key = "sha1";
      hash = m[1].length === 40 ? m[1].toLowerCase() : base32(m[1]);
    } else if (v2) {
      key = "sha256";
      hash = v2[1].toLowerCase();
    } else {
      warnings.push(
        "Unsupported or malformed exact-topic hash: " + xt.slice(0, 200),
      );
      continue;
    }
    if (hashes[key] && hashes[key] !== hash)
      throw new Error("Magnet contains conflicting hashes of the same type.");
    hashes[key] = hash;
  }
  if (!Object.keys(hashes).length)
    throw new Error(
      "No supported BitTorrent v1 or v2 hash found in this magnet.",
    );
  const xl = params.get("xl");
  if (xl && !/^\d{1,40}$/.test(xl))
    warnings.push("Invalid stated size was ignored.");
  return {
    kind: "magnet",
    name: params.get("dn") || "Unnamed magnet",
    format:
      hashes.sha1 && hashes.sha256
        ? "Hybrid magnet"
        : hashes.sha256
          ? "V2 magnet"
          : "V1 magnet",
    hashes,
    totalBytes: xl && /^\d{1,40}$/.test(xl) ? BigInt(xl).toString() : null,
    files: [],
    flaggedFiles: 0,
    trackers: [...new Set(params.getAll("tr"))].map(tracker),
    webSeeds: params.getAll("ws"),
    warnings: [
      ...warnings,
      "A magnet supplies identifiers and hints, not a verified file list. No peers or trackers have been contacted.",
    ],
    metadataBytes: null,
    private: null,
    paddingBytes: "0",
    pieceLength: null,
  };
}
export function formatBytes(value) {
  const n = BigInt(value);
  const units = ["B", "KiB", "MiB", "GiB", "TiB", "PiB", "EiB"];
  let index = 0,
    scale = 1n;
  while (n >= scale * 1024n && index < units.length - 1) {
    index++;
    scale *= 1024n;
  }
  return index
    ? `${Number((n * 100n) / scale) / 100} ${units[index]}`
    : `${n} B`;
}
export function reportText(r) {
  return JSON.stringify(
    {
      inspector: "Torrent Lens",
      scope:
        "Metadata only; no payload downloaded, no malware verdict, no tracker requests.",
      ...r,
    },
    null,
    2,
  );
}
export function demoTorrent() {
  return encoder.encode(
    "d8:announce36:https://tracker.example.org/announce4:infod6:lengthi1024e4:name10:readme.txt12:piece lengthi16384e6:pieces20:00000000000000000000ee",
  );
}
