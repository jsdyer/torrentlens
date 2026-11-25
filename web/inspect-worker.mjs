import { inspectTorrent, inspectMagnet, demoTorrent } from "./model.mjs";
self.onmessage = async ({ data }) => {
  try {
    const result =
      data.kind === "magnet"
        ? inspectMagnet(data.value)
        : await inspectTorrent(
            data.kind === "demo" ? demoTorrent() : new Uint8Array(data.bytes),
          );
    self.postMessage({ result });
  } catch (error) {
    self.postMessage({ error: error.message });
  }
};
