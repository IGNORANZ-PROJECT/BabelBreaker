import assert from "node:assert/strict";
import test from "node:test";

import {
  MODEL_CATALOG,
  MODEL_SOURCE,
} from "../scripts/model-catalog.mjs";
import {
  PRODUCTION_MODEL_BASE_URL,
  assertProductionModelBaseUrl,
  createModelRegistry,
  normalizeModelBaseUrl,
} from "../scripts/model-registry.mjs";

const supportedLanguages = [
  "ja",
  "ko",
  "zh-Hans",
  "zh-Hant",
  "de",
  "es",
  "fr",
  "pt",
  "ru",
  "it",
];

test("model catalog contains both directions through English", () => {
  const pairs = new Set(
    Object.values(MODEL_CATALOG).map(
      (model) => `${model.sourceLanguage}-${model.targetLanguage}`,
    ),
  );
  for (const language of supportedLanguages) {
    assert.ok(pairs.has(`en-${language}`), `missing en-${language}`);
    assert.ok(pairs.has(`${language}-en`), `missing ${language}-en`);
  }
  assert.equal(pairs.size, supportedLanguages.length * 2);
});

test("every pinned model file has integrity metadata", () => {
  for (const model of Object.values(MODEL_CATALOG)) {
    assert.ok(model.version);
    assert.ok(Object.keys(model.files).length >= 3);
    for (const file of Object.values(model.files)) {
      assert.ok(file.fileName);
      assert.match(file.location, /^[a-z_]+-[a-z_]+\/.+\.gz$/i);
      assert.ok(file.size > 0);
      assert.match(file.hash, /^[a-f0-9]{64}$/);
      assert.equal(file.compression, "gzip");
    }
  }
  assert.match(MODEL_SOURCE.revision, /^[a-f0-9]{40}$/);
});

test("production registry uses the pinned model mirror revision", () => {
  const registry = createModelRegistry(PRODUCTION_MODEL_BASE_URL);
  const urls = registry.models.flatMap((model) =>
    Object.values(model.files)
      .filter((file) => file?.name)
      .map((file) => file.name),
  );
  assert.ok(urls.length > 0);
  assert.ok(
    urls.every((url) => url.startsWith(`${PRODUCTION_MODEL_BASE_URL}/`)),
  );
  assert.equal(
    assertProductionModelBaseUrl(PRODUCTION_MODEL_BASE_URL),
    PRODUCTION_MODEL_BASE_URL,
  );
  assert.throws(
    () =>
      assertProductionModelBaseUrl(
        "https://raw.githubusercontent.com/another/project/main/models",
      ),
    /Production models/,
  );
  assert.equal(normalizeModelBaseUrl("/models/"), "/models");
  assert.throws(
    () => normalizeModelBaseUrl("http://models.example.com"),
    /HTTPS/,
  );
});
