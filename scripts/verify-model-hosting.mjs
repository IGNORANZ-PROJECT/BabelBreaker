import {
  PRODUCTION_MODEL_BASE_URL,
  assertProductionModelBaseUrl,
  createModelRegistry,
} from "./model-registry.mjs";

const baseUrl = assertProductionModelBaseUrl(PRODUCTION_MODEL_BASE_URL);
const allowedOrigin = "https://babel-breaker.web.app";
const registry = createModelRegistry(baseUrl);
const files = registry.models.flatMap((model) =>
  Object.values(model.files).filter((file) => file?.name),
);

const failures = [];
let cursor = 0;
const workers = Array.from({ length: Math.min(8, files.length) }, async () => {
  while (cursor < files.length) {
    const file = files[cursor++];
    try {
      const response = await fetch(file.name, {
        method: "HEAD",
        headers: { Origin: allowedOrigin },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const contentLength = Number(response.headers.get("content-length"));
      if (contentLength !== file.size) {
        throw new Error(`expected ${file.size} bytes, received ${contentLength}`);
      }
      const cors = response.headers.get("access-control-allow-origin");
      if (cors !== "*" && cors !== allowedOrigin) {
        throw new Error(`CORS does not allow ${allowedOrigin}`);
      }
    } catch (error) {
      failures.push(`${file.name}: ${error.message}`);
    }
  }
});
await Promise.all(workers);

if (failures.length) {
  throw new Error(
    `Model hosting verification failed:\n${failures.slice(0, 20).join("\n")}`,
  );
}
process.stdout.write(
  `Verified ${files.length} model files, sizes, and CORS at ${baseUrl}.\n`,
);
