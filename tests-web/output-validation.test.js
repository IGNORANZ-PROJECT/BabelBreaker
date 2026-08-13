import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";

import { validateNativeOutputLayout } from "../src/output-validation.js";

async function invalidLayout(kind, files, variant = "") {
  const zip = new JSZip();
  for (const [path, contents] of Object.entries(files)) zip.file(path, contents);
  return validateNativeOutputLayout(zip, { kind, variant, label: kind });
}

test("native output guards reject misplaced or incomplete game archives", async () => {
  const cases = [
    ["java_resource_pack", {
      "Wrapper/pack.mcmeta": JSON.stringify({ pack: { pack_format: 34, description: "Wrong root" } }),
      "Wrapper/assets/example/lang/ja_jp.json": "{}",
    }],
    ["data_pack", {
      "Wrapper/pack.mcmeta": JSON.stringify({ pack: { pack_format: 48, description: "Wrong root" } }),
      "Wrapper/data/example/function/start.mcfunction": "say start\n",
    }],
    ["java_world", { "World/level.dat": new Uint8Array([1]) }],
    ["bedrock_world", { "level.dat": new Uint8Array([1]) }],
    ["modpack", {
      "Pack/modrinth.index.json": JSON.stringify({ formatVersion: 1, game: "minecraft", name: "Pack", versionId: "1" }),
    }, "modrinth"],
    ["modpack", {
      "manifest.json": JSON.stringify({ manifestType: "minecraftModpack", manifestVersion: 2 }),
    }, "curseforge"],
    ["server_plugin_patch", { "README.txt": "No translated plugin files.\n" }],
    ["factorio", {
      "example/info.json": JSON.stringify({ name: "example" }),
      "example/locale/ja/base.cfg": "[item-name]\nitem=項目\n",
    }],
    ["stardew", {
      "Example/manifest.json": JSON.stringify({ Name: "Example", Version: "1.0.0" }),
      "Example/i18n/ja.json": "{}",
    }],
    ["rimworld", {
      "Example/About/About.xml": "<ModMetaData><name>Example</name></ModMetaData>",
      "Example/Languages/Japanese/Keyed/UI.xml": "<LanguageData />",
    }],
  ];

  for (const [kind, files, variant] of cases) {
    const result = await invalidLayout(kind, files, variant);
    assert.equal(result.valid, false, `${kind}:${variant || "default"} should be rejected`);
    assert.ok(result.errors.length > 0);
  }
});
