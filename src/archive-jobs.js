import { analyzeArchive, buildResourcePack } from "./core.js";

let worker = null;
let sequence = 0;
const jobs = new Map();

function supported() {
  return typeof Worker !== "undefined";
}

function ensureWorker() {
  if (worker || !supported()) return worker;
  worker = new Worker(new URL("./archive-worker.js", import.meta.url), {
    type: "module",
    name: "babel-breaker-archive",
  });
  worker.addEventListener("message", ({ data }) => {
    const job = jobs.get(data?.id);
    if (!job) return;
    if (data.type === "progress") {
      job.onProgress?.(data);
      return;
    }
    jobs.delete(data.id);
    job.cleanup();
    if (data.type === "result") job.resolve(data.result);
    else {
      const error = new Error(data.error?.message || "Archive worker failed.");
      error.name = data.error?.name || "Error";
      error.stack = data.error?.stack || error.stack;
      job.reject(error);
    }
  });
  worker.addEventListener("error", (event) => {
    const error = new Error(event.message || "Archive worker stopped unexpectedly.");
    for (const job of jobs.values()) {
      job.cleanup();
      job.reject(error);
    }
    jobs.clear();
    worker?.terminate();
    worker = null;
  });
  return worker;
}

function runWorker(action, payload, { signal, onProgress } = {}) {
  const activeWorker = ensureWorker();
  if (!activeWorker) return null;
  const id = `archive-${Date.now()}-${++sequence}`;
  return new Promise((resolve, reject) => {
    const abort = () => {
      jobs.delete(id);
      activeWorker.terminate();
      worker = null;
      const error = new DOMException("The operation was aborted.", "AbortError");
      reject(error);
    };
    const cleanup = () => signal?.removeEventListener("abort", abort);
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener("abort", abort, { once: true });
    jobs.set(id, { resolve, reject, onProgress, cleanup });
    activeWorker.postMessage({ id, action, payload });
  });
}

export async function analyzeArchiveInBackground(file, options, jobOptions = {}) {
  if (!supported()) return analyzeArchive(file, options);
  const bytes = new Uint8Array(await file.arrayBuffer());
  return runWorker("analyze", {
    name: file.name,
    type: file.type,
    bytes,
    options,
  }, jobOptions);
}

export async function buildArchiveInBackground(project, versionId, options, jobOptions = {}) {
  if (!supported()) {
    return buildResourcePack(project, versionId, "blob", options);
  }
  const result = await runWorker("build", { project, versionId, options }, jobOptions);
  return {
    filename: result.filename,
    archive: new Blob([result.archive], { type: "application/zip" }),
  };
}

export async function scanImagesInBackground(project, jobOptions = {}) {
  if (!supported()) {
    const { scanProjectImages } = await import("./image-assets.js");
    return scanProjectImages(project);
  }
  return runWorker("scan-images", { project }, jobOptions);
}
