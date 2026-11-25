import { formatBytes, reportText } from "./model.mjs";
import { config } from "./config.mjs";
const $ = (id) => document.getElementById(id);
let report = null,
  worker = null,
  timer = null,
  page = 0,
  sequence = 0;
const status = (text, error = false) => {
  $("status").textContent = text;
  $("status").classList.toggle("error", error);
};
function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function stop() {
  worker?.terminate();
  worker = null;
  clearTimeout(timer);
}
function reset() {
  sequence++;
  stop();
  report = null;
  page = 0;
  $("results").hidden = true;
  $("empty").hidden = false;
  $("download").hidden = true;
  $("magnet").value = "";
  $("file").value = "";
  $("filter").value = "";
  $("flags-only").checked = false;
  status("Cleared. Your file or link stays in this tab.");
}
function inspect(payload, transfer = []) {
  stop();
  const current = ++sequence;
  report = null;
  $("download").hidden = true;
  $("results").hidden = true;
  $("empty").hidden = false;
  status("Inspecting locally…");
  worker = new Worker(new URL("./inspect-worker.mjs", import.meta.url), {
    type: "module",
  });
  timer = setTimeout(() => {
    if (current !== sequence) return;
    stop();
    status(
      "Inspection exceeded the local time limit. Try a smaller file.",
      true,
    );
  }, 20000);
  worker.onmessage = ({ data }) => {
    if (current !== sequence) return;
    stop();
    if (data.error) {
      status(data.error, true);
      return;
    }
    report = data.result;
    page = 0;
    render();
    status(
      report.kind === "magnet"
        ? "Magnet decoded locally. No file list was requested."
        : "Inspection complete. No tracker or peer connections were made.",
    );
  };
  worker.onerror = () => {
    if (current !== sequence) return;
    stop();
    status(
      "The local inspector could not start. Reload this HTTPS page and try again.",
      true,
    );
  };
  worker.postMessage(payload, transfer);
}
async function readFile(file) {
  if (!file) return;
  const current = ++sequence;
  stop();
  if (file.size > config.maxBytes) {
    report = null;
    $("results").hidden = true;
    $("empty").hidden = false;
    $("download").hidden = true;
    status(
      `Choose a metadata file no larger than ${formatBytes(BigInt(config.maxBytes))}.`,
      true,
    );
    return;
  }
  try {
    const bytes = await file.arrayBuffer();
    if (current !== sequence) return;
    inspect({ kind: "torrent", bytes }, [bytes]);
  } catch {
    status("Could not read this file.", true);
  }
}
function metadata(name, value) {
  if (value === undefined || value === null || value === "") return;
  $("metadata").append(element("dt", name), element("dd", value));
}
function render() {
  const r = report;
  $("results").hidden = false;
  $("empty").hidden = true;
  $("download").hidden = false;
  $("format").textContent = r.format;
  $("name").textContent = r.name;
  $("size").textContent =
    r.totalBytes === null ? "Not supplied" : formatBytes(r.totalBytes);
  $("count").textContent =
    r.kind === "magnet" ? "Unknown" : r.files.length.toLocaleString();
  $("flagged").textContent =
    r.kind === "magnet" ? "Not inspected" : r.flaggedFiles.toLocaleString();
  $("scope").textContent =
    r.kind === "magnet"
      ? "Any name or size in a magnet is an unverified hint."
      : "Sizes describe the metadata, not files downloaded or verified. Padding bytes are excluded from listed payload.";
  $("warnings").hidden = !r.warnings.length;
  $("warning-list").replaceChildren(
    ...r.warnings.slice(0, 200).map((s) => element("li", s)),
  );
  if (r.warnings.length > 200)
    $("warning-list").append(
      element("li", "More notes are included in the downloaded report."),
    );
  $("metadata").replaceChildren();
  for (const [key, value] of Object.entries(r.hashes))
    metadata(
      key === "sha1" ? "v1 infohash · SHA-1" : "v2 infohash · SHA-256",
      value,
    );
  metadata(
    "Private flag",
    r.private === null
      ? "Not present in magnet"
      : r.private
        ? "Set — private torrent"
        : "Not set",
  );
  metadata("Piece length", r.pieceLength ? formatBytes(r.pieceLength) : null);
  metadata(
    "Padding",
    r.paddingBytes !== "0" ? formatBytes(r.paddingBytes) : null,
  );
  metadata("Created", r.creationDate);
  metadata("Created by", r.createdBy);
  metadata("Comment", r.comment);
  metadata(
    "Metadata file size",
    r.metadataBytes !== null ? formatBytes(BigInt(r.metadataBytes)) : null,
  );
  $("tracker-count").textContent =
    `(${r.trackers.length} trackers, ${r.webSeeds.length} web seeds)`;
  $("trackers").replaceChildren();
  for (const t of r.trackers.slice(0, 100)) {
    const li = element("li");
    li.append(
      element("strong", t.host),
      element("code", t.url),
      element("small", t.warning || t.scheme),
    );
    $("trackers").append(li);
  }
  for (const url of r.webSeeds.slice(0, 100)) {
    const li = element("li");
    li.append(element("strong", "Web seed"), element("code", url));
    $("trackers").append(li);
  }
  if (r.trackers.length > 100 || r.webSeeds.length > 100)
    $("trackers").append(
      element(
        "li",
        "Showing up to 100 of each address type; download includes all.",
      ),
    );
  if (!r.trackers.length && !r.webSeeds.length)
    $("trackers").append(
      element("li", "No tracker or web-seed addresses supplied."),
    );
  $("files-section").hidden = r.kind === "magnet";
  renderFiles();
}
function renderFiles() {
  if (!report) return;
  const query = $("filter").value.toLowerCase(),
    only = $("flags-only").checked;
  const files = report.files.filter(
    (f) =>
      (!query || f.path.toLowerCase().includes(query)) &&
      (!only || f.flags.length),
  );
  const pages = Math.max(1, Math.ceil(files.length / config.pageSize));
  page = Math.min(page, pages - 1);
  $("file-list").replaceChildren();
  for (const f of files.slice(
    page * config.pageSize,
    (page + 1) * config.pageSize,
  )) {
    const row = element("tr");
    row.append(
      element("td", f.path, "path"),
      element("td", formatBytes(f.size), "size"),
      element(
        "td",
        f.flags.join(" · ") || (f.padding ? "Padding" : "—"),
        f.flags.length ? "flag" : "",
      ),
    );
    $("file-list").append(row);
  }
  if (!files.length) {
    const row = element("tr"),
      cell = element("td", "No matching files.");
    cell.colSpan = 3;
    row.append(cell);
    $("file-list").append(row);
  }
  $("pagination").textContent =
    `${files.length.toLocaleString()} matches · Page ${page + 1} of ${pages}`;
  $("previous").disabled = page === 0;
  $("next").disabled = page >= pages - 1;
}
$("file-limit").textContent =
  `Up to ${formatBytes(BigInt(config.maxBytes))} of metadata`;
$("magnet").maxLength = config.maxMagnetLength;
$("magnet-form").addEventListener("submit", (e) => {
  e.preventDefault();
  inspect({ kind: "magnet", value: $("magnet").value });
});
$("file").addEventListener("change", () => readFile($("file").files[0]));
$("demo").addEventListener("click", () => inspect({ kind: "demo" }));
$("clear").addEventListener("click", reset);
for (const id of ["filter", "flags-only"])
  $(id).addEventListener("input", () => {
    page = 0;
    renderFiles();
  });
$("previous").onclick = () => {
  page--;
  renderFiles();
};
$("next").onclick = () => {
  page++;
  renderFiles();
};
$("download").onclick = () => {
  if (!report) return;
  const blob = new Blob([reportText(report)], { type: "application/json" }),
    url = URL.createObjectURL(blob),
    a = element("a");
  a.href = url;
  a.download = "torrentlens-report.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
for (const name of ["dragenter", "dragover"])
  $("dropzone").addEventListener(name, (e) => {
    e.preventDefault();
    $("dropzone").classList.add("dragging");
  });
for (const name of ["dragleave", "drop"])
  $("dropzone").addEventListener(name, (e) => {
    e.preventDefault();
    $("dropzone").classList.remove("dragging");
  });
$("dropzone").addEventListener("drop", (e) =>
  readFile(e.dataTransfer.files[0]),
);
