import { promises as fs } from "node:fs";
import path from "node:path";

import { MODEL_CATALOG, MODEL_SOURCE } from "./model-catalog.mjs";

export const MODEL_REPOSITORY = MODEL_SOURCE.repository;
export const MODEL_REVISION = MODEL_SOURCE.revision;
export const PRODUCTION_MODEL_BASE_URL = MODEL_SOURCE.baseUrl;

export function normalizeModelBaseUrl(value = "/models") {
  const trimmed = String(value || "").trim().replace(/\/+$/, "");
  if (trimmed.startsWith("/")) return trimmed || "/models";

  const url = new URL(trimmed);
  if (url.protocol !== "https:" && url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
    throw new Error("Model asset URLs must use HTTPS.");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("Model asset base URL must not contain credentials, a query, or a fragment.");
  }
  return url.toString().replace(/\/+$/, "");
}

export function assertProductionModelBaseUrl(value) {
  const normalized = normalizeModelBaseUrl(value);
  if (normalized !== PRODUCTION_MODEL_BASE_URL) {
    throw new Error(
      `Production models must use ${PRODUCTION_MODEL_BASE_URL}.`,
    );
  }
  return normalized;
}

export function createModelRegistry(baseUrl = "/models") {
  const normalizedBaseUrl = normalizeModelBaseUrl(baseUrl);
  return {
    models: Object.values(MODEL_CATALOG).map((model) => {
      const pairName = `${model.sourceLanguage}-${model.targetLanguage}`;
      const files = Object.fromEntries(
        Object.entries(model.files).map(([part, file]) => [
          part,
          {
            name:
              normalizedBaseUrl === PRODUCTION_MODEL_BASE_URL
                ? `${normalizedBaseUrl}/${file.location}`
                : `${normalizedBaseUrl}/${pairName}/${file.fileName}`,
            size: file.size,
            expectedSha256Hash: file.hash,
            ...(file.compression ? { compression: file.compression } : {}),
          },
        ]),
      );
      files.config = { "gemm-precision": "int8shiftAlphaAll" };
      return {
        from: model.sourceLanguage,
        to: model.targetLanguage,
        version: model.version,
        files,
      };
    }),
  };
}

export async function writeModelRegistry(destination, baseUrl = "/models") {
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(
    destination,
    `${JSON.stringify(createModelRegistry(baseUrl), null, 2)}\n`,
    "utf8",
  );
}
