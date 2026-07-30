import { promises as fs } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  PRODUCTION_MODEL_BASE_URL,
  assertProductionModelBaseUrl,
  writeModelRegistry,
} from "./model-registry.mjs";
import { prepareRuntimeAssets } from "./runtime-assets.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicRegistry = path.join(projectRoot, "public", "model-registry.json");
const distDirectory = path.join(projectRoot, "dist");
const distModels = path.join(distDirectory, "models");

function runNodeScript(scriptPath, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd: projectRoot,
      stdio: "inherit",
      shell: false,
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${path.basename(scriptPath)} exited with code ${code}`));
    });
  });
}

const baseUrl = assertProductionModelBaseUrl(PRODUCTION_MODEL_BASE_URL);
await runNodeScript(path.join(projectRoot, "scripts", "prepare-legal.mjs"));
await prepareRuntimeAssets(projectRoot);
await writeModelRegistry(publicRegistry, baseUrl);
await runNodeScript(path.join(projectRoot, "node_modules", "vite", "bin", "vite.js"), [
  "build",
]);

const resolvedDistModels = path.resolve(distModels);
if (!resolvedDistModels.startsWith(`${path.resolve(distDirectory)}${path.sep}`)) {
  throw new Error("Refusing to clean an unexpected model output path.");
}
await fs.rm(resolvedDistModels, { recursive: true, force: true });

const registry = JSON.parse(
  await fs.readFile(path.join(distDirectory, "model-registry.json"), "utf8"),
);
if (
  registry.models.some((model) =>
    Object.values(model.files).some(
      (file) => file?.name && !String(file.name).startsWith(baseUrl),
    ),
  )
) {
  throw new Error("Firebase registry contains a non-external model URL.");
}

process.stdout.write(
  `Firebase build uses pinned external model files at ${baseUrl}; dist/models was excluded.\n`,
);
