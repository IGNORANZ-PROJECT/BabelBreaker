import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  PRODUCTION_MODEL_BASE_URL,
  writeModelRegistry,
} from "./model-registry.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
await writeModelRegistry(
  path.join(projectRoot, "public", "model-registry.json"),
  PRODUCTION_MODEL_BASE_URL,
);
