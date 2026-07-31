import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  MODEL_REPOSITORY,
  MODEL_REVISION,
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
  const app = await read("src/app.js");
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
  assert.match(app, /https:\/\/ignoranz-project\.web\.app\//);
  assert.match(app, /https:\/\/x\.com\/IGNORANZ_P/);
  assert.match(app, /rel="noopener noreferrer"/);
});

test("production models are pinned to an immutable public mirror commit", () => {
  assert.equal(MODEL_REPOSITORY, "mukowaty/firefox-translations");
  assert.match(MODEL_REVISION, /^[a-f0-9]{40}$/);
  assert.equal(
    PRODUCTION_MODEL_BASE_URL,
    `https://huggingface.co/${MODEL_REPOSITORY}/resolve/${MODEL_REVISION}`,
  );
});

test("Firebase permits only the pinned Hugging Face model hosts", async () => {
  const firebaseConfig = JSON.parse(await read("firebase.json"));
  const globalHeaders = firebaseConfig.hosting.headers.find(
    (rule) => rule.source === "**",
  ).headers;
  const csp = globalHeaders.find(
    (header) => header.key === "Content-Security-Policy",
  ).value;
  assert.match(csp, /connect-src 'self' https:\/\/huggingface\.co/);
  assert.match(csp, /https:\/\/\*\.hf\.co/);
  assert.doesNotMatch(csp, /r2\.dev|storage\.googleapis\.com|raw\.githubusercontent\.com/);
  assert.equal(firebaseConfig.hosting.public, "dist");
  assert.equal(firebaseConfig.functions, undefined);
  for (const source of ["/", "/index.html"]) {
    const rule = firebaseConfig.hosting.headers.find((item) => item.source === source);
    assert.equal(
      rule?.headers.find((header) => header.key === "Cache-Control")?.value,
      "no-cache",
    );
  }
});

test("tracked legal notices cover the app and translation models", async () => {
  assert.match(await read("public/LICENSE.txt"), /MIT License/);
  const notices = await read("public/THIRD_PARTY_NOTICES.txt");
  assert.match(notices, /Mozilla Firefox Translations/);
  assert.match(notices, /Mozilla Public License Version 2\.0/);
  assert.match(notices, /@browsermt\/bergamot-translator@/);
  assert.match(notices, /jszip@/);
});

test("privacy and security disclosures identify Firebase and model hosting", async () => {
  const privacy = await read("PRIVACY.md");
  const security = await read("SECURITY.md");
  assert.match(privacy, /Firebase Hosting/);
  assert.match(privacy, /Hugging Face/);
  assert.match(security, /Hugging Face/);
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

test("public SEO metadata is complete and crawlable", async () => {
  const html = await read("index.html");
  assert.match(html, /rel="canonical" href="https:\/\/babel-breaker\.web\.app\/"/);
  assert.match(html, /property="og:url"/);
  assert.match(html, /name="twitter:card"/);
  assert.match(html, /type="application\/ld\+json"/);
  assert.match(html, /"@type": "WebApplication"/);
  assert.match(html, /Minecraft, Factorio, Stardew Valley, and RimWorld/);

  const robots = await read("public/robots.txt");
  assert.match(robots, /Allow: \//);
  assert.match(robots, /https:\/\/babel-breaker\.web\.app\/sitemap\.xml/);
  const sitemap = await read("public/sitemap.xml");
  assert.match(sitemap, /<loc>https:\/\/babel-breaker\.web\.app\/<\/loc>/);
});
