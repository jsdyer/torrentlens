/** Public, offline settings. Raising limits increases local CPU/memory use. */
export const config = Object.freeze({
  maxBytes: 16 * 1024 * 1024,
  maxNodes: 250000,
  maxDepth: 64,
  maxFiles: 50000,
  pageSize: 100,
  maxMagnetLength: 100000,
});
