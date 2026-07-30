import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  GITHUB_MODEL_REPOSITORY,
  GITHUB_MODEL_REVISION,
  PRODUCTION_MODEL_BASE_URL,
} from "../scripts/model-registry.mjs";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

async function read(relativePath) {
  return fs.readFile(path.join(projectRoot, relativePath), "utf8");
}

test("release metadata identifies the public MIT repository", async () => {
  const packageMetadata = JSON.parse(await read("package.json"));
  assert.equal(packageMetadata.license, "MIT");
  assert.equal(
    packageMetadata.repository.url,
    "https://github.com/IGNORANZ-PROJECT/BabelBreaker.git",
  );
  assert.match(await read("LICENSE"), /MIT License/);
  assert.match(
    await read("README.md"),
    /https:\/\/github\.com\/IGNORANZ-PROJECT\/BabelBreaker/,
  );
});

test("production models are pinned to this repository", () => {
  assert.equal(GITHUB_MODEL_REPOSITORY, "IGNORANZ-PROJECT/BabelBreaker");
  assert.match(GITHUB_MODEL_REVISION, /^models-v[1-9][0-9]*$/);
  assert.equal(
    PRODUCTION_MODEL_BASE_URL,
    `https://raw.githubusercontent.com/${GITHUB_MODEL_REPOSITORY}/${GITHUB_MODEL_REVISION}/public/models`,
  );
});

test("Firebase permits only the pinned GitHub model origin", async () => {
  const firebaseConfig = JSON.parse(await read("firebase.json"));
  const globalHeaders = firebaseConfig.hosting.headers.find(
    (rule) => rule.source === "**",
  ).headers;
  const csp = globalHeaders.find(
    (header) => header.key === "Content-Security-Policy",
  ).value;
  assert.match(csp, /connect-src 'self' https:\/\/raw\.githubusercontent\.com/);
  assert.doesNotMatch(csp, /r2\.dev|storage\.googleapis\.com/);
  assert.equal(firebaseConfig.hosting.public, "dist");
  assert.equal(firebaseConfig.functions, undefined);
});

test("tracked legal notices cover the app and translation models", async () => {
  assert.match(await read("public/LICENSE.txt"), /MIT License/);
  const notices = await read("public/THIRD_PARTY_NOTICES.txt");
  assert.match(notices, /Mozilla Firefox Translations/);
  assert.match(notices, /Mozilla Public License Version 2\.0/);
  assert.match(notices, /@browsermt\/bergamot-translator@/);
  assert.match(notices, /jszip@/);
});

test("privacy and security disclosures identify Firebase and GitHub", async () => {
  const privacy = await read("PRIVACY.md");
  const security = await read("SECURITY.md");
  assert.match(privacy, /Firebase Hosting/);
  assert.match(privacy, /GitHub/);
  assert.match(security, /raw\.githubusercontent\.com/);
  assert.match(security, /SHA-256/);
});

test("required Web assets are present", async () => {
  for (const relativePath of [
    "public/icon.png",
    "public/icon-192.png",
    "public/icon-ui.png",
    "public/manifest.webmanifest",
    "public/bergamot/translator-worker.js",
    "public/bergamot/bergamot-translator-worker.js",
    "public/bergamot/bergamot-translator-worker.wasm",
  ]) {
    const stats = await fs.stat(path.join(projectRoot, relativePath));
    assert.ok(stats.isFile());
    assert.ok(stats.size > 0);
  }
});
