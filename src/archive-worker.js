import { analyzeArchive, buildResourcePack } from "./core.js";
import { scanProjectImages } from "./image-assets.js";

function post(id, message, transfer = []) {
  self.postMessage({ id, ...message }, transfer);
}

self.addEventListener("message", async (event) => {
  const { id, action, payload } = event.data || {};
  if (!id) return;
  try {
    if (action === "analyze") {
      post(id, { type: "progress", phase: "opening", percent: 5 });
      const bytes = payload.bytes instanceof Uint8Array
        ? payload.bytes
        : new Uint8Array(payload.bytes);
      const file = {
        name: payload.name,
        size: bytes.byteLength,
        type: payload.type || "application/octet-stream",
        async arrayBuffer() {
          return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        },
      };
      const project = await analyzeArchive(file, payload.options || {});
      post(id, { type: "progress", phase: "analyzed", percent: 100 });
      post(id, { type: "result", result: project });
      return;
    }
    if (action === "build") {
      post(id, { type: "progress", phase: "building", percent: 10 });
      const result = await buildResourcePack(
        payload.project,
        payload.versionId,
        "uint8array",
        payload.options || {},
      );
      const bytes = result.archive instanceof Uint8Array
        ? result.archive
        : new Uint8Array(result.archive);
      post(id, { type: "progress", phase: "built", percent: 100 });
      post(
        id,
        { type: "result", result: { filename: result.filename, archive: bytes } },
        [bytes.buffer],
      );
      return;
    }
    if (action === "scan-images") {
      post(id, { type: "progress", phase: "scanning-images", percent: 10 });
      const result = await scanProjectImages(payload.project);
      post(id, { type: "progress", phase: "scanned-images", percent: 100 });
      post(id, { type: "result", result });
      return;
    }
    throw new Error(`Unknown archive job: ${action}`);
  } catch (error) {
    post(id, {
      type: "error",
      error: {
        name: error?.name || "Error",
        message: error?.message || String(error),
        stack: error?.stack || "",
      },
    });
  }
});
