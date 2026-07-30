import { promises as fs } from "node:fs";
import path from "node:path";

export async function prepareRuntimeAssets(projectRoot) {
  const runtimeDirectory = path.join(projectRoot, "public", "bergamot");
  const packageRoot = path.join(
    projectRoot,
    "node_modules",
    "@browsermt",
    "bergamot-translator",
  );
  const packageWorkerDirectory = path.join(packageRoot, "worker");

  await fs.mkdir(runtimeDirectory, { recursive: true });
  for (const fileName of [
    "translator-worker.js",
    "bergamot-translator-worker.js",
    "bergamot-translator-worker.wasm",
  ]) {
    await fs.copyFile(
      path.join(packageWorkerDirectory, fileName),
      path.join(runtimeDirectory, fileName),
    );
  }
}
