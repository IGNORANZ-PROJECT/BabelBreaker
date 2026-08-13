import assert from "node:assert/strict";
import { File } from "node:buffer";
import test from "node:test";
import JSZip from "jszip";
import { readLevelDb } from "mcbe-leveldb-reader";

import { analyzeArchive, buildResourcePack, combineProjects } from "../src/core.js";
import { validateBedrockAddonArchive, validateBedrockPack } from "../src/artifact-formats.js";
import {
  NBT_TAG,
  decodeNbtSequence,
  encodeNbtSequence,
  parseNbt,
  writeNbt,
} from "../src/nbt.js";
import {
  buildLevelDbManifestLog,
  buildLevelDbWriteLog,
  decodeLevelDbWriteLog,
} from "../src/bedrock-leveldb.js";

async function archiveFile(name, files) {
  const zip = new JSZip();
  for (const [path, contents] of Object.entries(files)) zip.file(path, contents);
  return new File([await zip.generateAsync({ type: "uint8array" })], name);
}

function translate(project, replacements = {}) {
  for (const entry of project.entries) {
    entry.translation = replacements[entry.source] || `訳:${entry.source}`;
    entry.status = "edited";
  }
}

function makeRegionWithSign() {
  const chunk = writeNbt({
    compression: "zlib",
    root: {
      type: NBT_TAG.COMPOUND,
      name: "",
      value: [{
        type: NBT_TAG.LIST,
        name: "block_entities",
        value: {
          elementType: NBT_TAG.COMPOUND,
          items: [[
            { type: NBT_TAG.STRING, name: "id", value: "minecraft:oak_sign" },
            { type: NBT_TAG.COMPOUND, name: "front_text", value: [{
              type: NBT_TAG.LIST,
              name: "messages",
              value: { elementType: NBT_TAG.STRING, items: [JSON.stringify({ text: "Welcome traveler" }), JSON.stringify({ text: "Second line" }), JSON.stringify({ text: "" }), JSON.stringify({ text: "" })] },
            }] },
          ]],
        },
      }],
    },
  });
  const region = new Uint8Array(4096 * 3);
  region[2] = 2;
  region[3] = 1;
  const view = new DataView(region.buffer);
  view.setUint32(4096 * 2, chunk.byteLength + 1, false);
  region[4096 * 2 + 4] = 2;
  region.set(chunk, 4096 * 2 + 5);
  return region;
}

function firstRegionChunk(region) {
  const view = new DataView(region.buffer, region.byteOffset, region.byteLength);
  const sector = (region[0] << 16) | (region[1] << 8) | region[2];
  const start = sector * 4096;
  const length = view.getUint32(start, false);
  return parseNbt(region.slice(start + 5, start + 4 + length));
}

async function outputZip(project, options) {
  const result = await buildResourcePack(
    project,
    project.minecraftVersion,
    "nodebuffer",
    options,
  );
  return {
    ...result,
    zip: await JSZip.loadAsync(result.archive, { checkCRC32: true }),
  };
}

test("Java resource packs are detected and returned as a minimal translation overlay", async () => {
  const file = await archiveFile("CleanUI.zip", {
    "pack.mcmeta": JSON.stringify({ pack: { pack_format: 34, description: "Clean UI" } }),
    "assets/clean/lang/en_us.json": JSON.stringify({ "menu.start": "Start Game" }),
    "assets/clean/textures/gui.png": new Uint8Array([1, 2, 3]),
  });
  const project = await analyzeArchive(file);
  assert.equal(project.artifactType, "resource_pack");
  translate(project, { "Start Game": "ゲーム開始" });
  const resultArchive = await outputZip(project);
  const { zip } = resultArchive;
  assert.deepEqual(JSON.parse(await zip.file("assets/clean/lang/ja_jp.json").async("string")), { "menu.start": "ゲーム開始" });
  assert.equal(zip.file("assets/clean/textures/gui.png"), null);
  assert.equal(
    (await analyzeArchive(new File([resultArchive.archive], resultArchive.filename))).artifactType,
    "resource_pack",
  );
});

test("data packs translate only known visible text component fields", async () => {
  const file = await archiveFile("Story.zip", {
    "pack.mcmeta": JSON.stringify({ pack: { pack_format: 48, description: "Story" } }),
    "data/story/advancement/chapter.json": JSON.stringify({
      display: { title: { text: "First Chapter" }, description: { text: "Find the gate" }, icon: { id: "minecraft:book" } },
      criteria: { gate: { trigger: "minecraft:location" } },
    }),
    "data/story/function/welcome.mcfunction": "tellraw @a {text:'Welcome hero',color:'gold'}\ngive @a minecraft:book\n",
  });
  const project = await analyzeArchive(file);
  assert.equal(project.artifactType, "data_pack");
  assert.deepEqual(project.entries.map((entry) => entry.source).sort(), ["Find the gate", "First Chapter", "Welcome hero"]);
  translate(project, { "First Chapter": "第一章", "Find the gate": "門を探す", "Welcome hero": "勇者よ、ようこそ" });
  const resultArchive = await outputZip(project);
  const { zip } = resultArchive;
  const result = JSON.parse(await zip.file("data/story/advancement/chapter.json").async("string"));
  assert.equal(result.display.title.text, "第一章");
  assert.equal(result.criteria.gate.trigger, "minecraft:location");
  const command = await zip.file("data/story/function/welcome.mcfunction").async("string");
  assert.match(command, /勇者よ、ようこそ/);
  assert.match(command, /give @a minecraft:book/);
  assert.equal(
    (await analyzeArchive(new File([resultArchive.archive], resultArchive.filename))).artifactType,
    "data_pack",
  );
});

test("Bedrock packs export as collision-free translated copies", async () => {
  const manifest = { format_version: 2, header: { name: "Example", uuid: "11111111-1111-1111-1111-111111111111", version: [1, 0, 0] }, modules: [{ type: "resources", uuid: "22222222-2222-2222-2222-222222222222", version: [1, 0, 0] }] };
  const file = await archiveFile("Example.mcpack", {
    "manifest.json": JSON.stringify(manifest),
    "texts/languages.json": JSON.stringify(["en_US"]),
    "texts/en_US.lang": "# Item names\nitem.example.name=Example Item\t###Shown in inventory\n",
  });
  const project = await analyzeArchive(file);
  assert.equal(project.artifactType, "resource_pack");
  assert.equal(project.targetLocale, "ja_JP");
  translate(project, { "Example Item": "サンプルアイテム" });
  const { zip, filename } = await outputZip(project);
  assert.match(filename, /\.ja_JP\.mcpack$/);
  const lang = await zip.file("texts/ja_JP.lang").async("string");
  assert.match(lang, /サンプルアイテム/);
  assert.match(lang, /###Shown in inventory/);
  assert.deepEqual(JSON.parse(await zip.file("texts/languages.json").async("string")), ["en_US", "ja_JP"]);
  const outputManifest = JSON.parse(await zip.file("manifest.json").async("string"));
  assert.notEqual(outputManifest.header.uuid, manifest.header.uuid);
  assert.notEqual(outputManifest.modules[0].uuid, manifest.modules[0].uuid);
  assert.deepEqual(outputManifest.header.version, [1, 0, 0]);
  assert.deepEqual(outputManifest.modules[0].version, [1, 0, 0]);
});

test("wrapped Bedrock packs normalize the root before updating the manifest", async () => {
  const file = await archiveFile("Wrapped.mcpack", {
    "Wrapped/manifest.json": JSON.stringify({
      format_version: 2,
      header: { name: "Wrapped", uuid: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", version: [2, 3, 4] },
      modules: [{ type: "resources", uuid: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", version: [2, 3, 4] }],
    }),
    "Wrapped/texts/en_US.lang": "item.wrapped.name=Wrapped Item\n",
  });
  const project = await analyzeArchive(file);
  translate(project, { "Wrapped Item": "包まれたアイテム" });
  const { zip } = await outputZip(project);
  assert.equal(zip.file("Wrapped/manifest.json"), null);
  assert.deepEqual(JSON.parse(await zip.file("manifest.json").async("string")).header.version, [2, 3, 4]);
  assert.match(await zip.file("texts/ja_JP.lang").async("string"), /包まれたアイテム/);
});

test("Bedrock resource packs distributed as zip download as mcpack", async () => {
  const file = await archiveFile("BedrockResources.zip", {
    "manifest.json": JSON.stringify({
      format_version: 2,
      header: { name: "Resources", uuid: "12121212-1212-1212-1212-121212121212", version: [1, 0, 0] },
      modules: [{ type: "resources", uuid: "34343434-3434-3434-3434-343434343434", version: [1, 0, 0] }],
    }),
    "texts/en_US.lang": "item.example.name=Example Item\n",
  });
  const project = await analyzeArchive(file);
  translate(project, { "Example Item": "サンプルアイテム" });
  const { filename, zip } = await outputZip(project);
  assert.match(filename, /\.mcpack$/);
  assert.ok(zip.file("manifest.json"));
  assert.match(await zip.file("texts/ja_JP.lang").async("string"), /サンプルアイテム/);
});

test("mcaddon containers rebuild their nested packs", async () => {
  const resource = new JSZip();
  resource.file("manifest.json", JSON.stringify({ format_version: 2, header: { name: "Resource", uuid: "11111111-1111-1111-1111-111111111111", version: [1, 0, 0] }, modules: [{ type: "resources", uuid: "22222222-2222-2222-2222-222222222222", version: [1, 0, 0] }] }));
  resource.file("texts/languages.json", JSON.stringify(["en_US"]));
  resource.file("texts/en_US.lang", "entity.example.name=Example Creature\n");
  const file = await archiveFile("Creatures.mcaddon", {
    "Creatures-Resources.mcpack": await resource.generateAsync({ type: "uint8array" }),
  });
  const project = await analyzeArchive(file);
  assert.equal(project.artifactType, "bedrock_addon");
  assert.deepEqual(project.documents[0].localizationEvidence, {
    confirmed: true,
    languageFileCount: 1,
    languagesJson: "valid",
    declaredLocales: ["en_us"],
  });
  translate(project, { "Example Creature": "サンプルの生物" });
  const resultArchive = await outputZip(project);
  const { zip } = resultArchive;
  const rebuilt = await JSZip.loadAsync(
    await zip.file("Creatures-Resources.mcpack").async("uint8array"),
    { checkCRC32: true },
  );
  assert.match(await rebuilt.file("texts/ja_JP.lang").async("string"), /サンプルの生物/);
  assert.match(await rebuilt.file("texts/en_US.lang").async("string"), /Example Creature/);
  assert.equal(
    (await analyzeArchive(new File([resultArchive.archive], resultArchive.filename))).artifactType,
    "bedrock_addon",
  );
});

test("mcaddon accepts BOM, comments, and trailing commas in Bedrock manifests", async () => {
  const resourceUuid = "51515151-5151-5151-5151-515151515151";
  const resource = new JSZip();
  resource.file("TNW-R/manifest.json", `\uFEFF{
    // Some published Bedrock packs use JSON with comments.
    "format_version": 2,
    "header": {
      "name": "TNW resources",
      "description": "Docs: https://example.com/addon//resources",
      "uuid": "${resourceUuid}",
      "version": [1, 0, 0],
    },
    "modules": [{
      "type": "resources",
      "uuid": "52525252-5252-5252-5252-525252525252",
      "version": [1, 0, 0],
    }],
  }`);
  resource.file("TNW-R/texts/en_US.lang", "item.tnw.name=Test item\n");

  const behavior = new JSZip();
  behavior.file("TNW-B/manifest.json", `{
    /* Keep the linked behavior pack in sync. */
    "format_version": 2,
    "header": {
      "name": "TNW behavior",
      "description": "Behavior pack",
      "uuid": "53535353-5353-5353-5353-535353535353",
      "version": [1, 0, 0]
    },
    "modules": [{
      "type": "data",
      "uuid": "54545454-5454-5454-5454-545454545454",
      "version": [1, 0, 0]
    }],
    "dependencies": [{
      "uuid": "${resourceUuid}",
      "version": [1, 0, 0],
    }],
  }`);

  const file = await archiveFile("TNW.mcaddon", {
    "TNW-R.mcpack": await resource.generateAsync({ type: "uint8array" }),
    "TNW-B.mcpack": await behavior.generateAsync({ type: "uint8array" }),
  });
  const project = await analyzeArchive(file);
  assert.equal(project.artifactType, "bedrock_addon");
  translate(project, { "Test item": "テストアイテム" });
  const resultArchive = await outputZip(project);
  const { zip } = resultArchive;
  const rebuiltResource = await JSZip.loadAsync(await zip.file("TNW-R.mcpack").async("uint8array"));
  const rebuiltBehavior = await JSZip.loadAsync(await zip.file("TNW-B.mcpack").async("uint8array"));
  const resourceManifest = JSON.parse(await rebuiltResource.file("manifest.json").async("string"));
  const behaviorManifest = JSON.parse(await rebuiltBehavior.file("manifest.json").async("string"));
  assert.deepEqual(resourceManifest.header.version, [1, 0, 0]);
  assert.equal(resourceManifest.header.description, "Docs: https://example.com/addon//resources");
  assert.equal(behaviorManifest.dependencies[0].uuid, resourceManifest.header.uuid);
  assert.deepEqual(behaviorManifest.dependencies[0].version, [1, 0, 0]);
  assert.match(await rebuiltResource.file("texts/ja_JP.lang").async("string"), /テストアイテム/);
});

test("Bedrock manifest compatibility parsing still rejects incomplete comments", async () => {
  const pack = new JSZip();
  pack.file("manifest.json", `{
    "format_version": 2,
    "header": {
      "name": "Broken",
      "uuid": "61616161-6161-6161-6161-616161616161",
      "version": [1, 0, 0]
    },
    "modules": [{
      "type": "resources",
      "uuid": "62626262-6262-6262-6262-626262626262",
      "version": [1, 0, 0]
    }]
  } /*`);
  const result = await validateBedrockPack(pack);
  assert.equal(result.valid, false);
  assert.match(result.errors.join(" "), /not valid JSON/);
});

test("mcaddon converts loose pack directories to root-level mcpack files", async () => {
  const resourceUuid = "10101010-1010-1010-1010-101010101010";
  const file = await archiveFile("Folders.mcaddon", {
    "RP/manifest.json": JSON.stringify({
      format_version: 2,
      header: { name: "RP", description: "Resources", uuid: resourceUuid, version: [1, 0, 0] },
      modules: [{ type: "resources", uuid: "20202020-2020-2020-2020-202020202020", version: [1, 0, 0] }],
    }),
    "RP/texts/en_US.lang": "title=Original title\n",
    "BP/manifest.json": JSON.stringify({
      format_version: 2,
      header: { name: "BP", description: "Behavior", uuid: "30303030-3030-3030-3030-303030303030", version: [1, 0, 0] },
      modules: [{ type: "data", uuid: "40404040-4040-4040-4040-404040404040", version: [1, 0, 0] }],
      dependencies: [
        { module_name: "@minecraft/server", version: "2.2.0-beta" },
        { module_name: "@minecraft/server-ui", version: "2.1.0-beta" },
        { uuid: resourceUuid, version: [1, 0, 0] },
      ],
    }),
    "BP/functions/start.mcfunction": "say ready\n",
  });
  const looseArchive = await JSZip.loadAsync(await file.arrayBuffer());
  const looseValidation = await validateBedrockAddonArchive(looseArchive, {
    requirePackArchives: true,
  });
  assert.equal(looseValidation.valid, false);
  assert.match(looseValidation.errors.join(" "), /loose pack folders/);
  const project = await analyzeArchive(file);
  assert.equal(project.artifactType, "bedrock_addon");
  translate(project, { "Original title": "翻訳タイトル" });
  const { zip } = await outputZip(project);
  assert.equal(zip.file("RP/manifest.json"), null);
  assert.equal(zip.file("BP/manifest.json"), null);
  const resourcePack = await JSZip.loadAsync(await zip.file("RP.mcpack").async("uint8array"), { checkCRC32: true });
  const behaviorPack = await JSZip.loadAsync(await zip.file("BP.mcpack").async("uint8array"), { checkCRC32: true });
  assert.ok(resourcePack.file("manifest.json"));
  assert.ok(behaviorPack.file("manifest.json"));
  assert.ok(behaviorPack.file("functions/start.mcfunction"));
  assert.match(await resourcePack.file("texts/ja_JP.lang").async("string"), /翻訳タイトル/);
  const resourceManifest = JSON.parse(await resourcePack.file("manifest.json").async("string"));
  const behaviorManifest = JSON.parse(await behaviorPack.file("manifest.json").async("string"));
  assert.notEqual(resourceManifest.header.uuid, resourceUuid);
  assert.equal(behaviorManifest.dependencies[0].version, "2.2.0");
  assert.equal(behaviorManifest.dependencies[1].version, "2.1.0");
  assert.equal(behaviorManifest.dependencies[2].uuid, resourceManifest.header.uuid);
  assert.equal((await validateBedrockAddonArchive(zip, { requirePackArchives: true })).valid, true);
});

test("mcaddon preserves legacy content while creating a separate translated identity", async () => {
  const behaviorUuid = "71717171-7171-7171-7171-717171717171";
  const resourceUuid = "72727272-7272-7272-7272-727272727272";
  const file = await archiveFile("TNW-like.ja_JP.mcaddon", {
    "TNW-B/manifest.json": JSON.stringify({
      format_version: 2,
      header: { name: "Behavior", description: "Behavior", uuid: behaviorUuid, version: [1, 0, 0] },
      modules: [{ type: "script", language: "Javascript", entry: "scripts/main.js", uuid: "73737373-7373-7373-7373-737373737373", version: [1, 0, 0] }],
      dependencies: [{ uuid: resourceUuid, version: [1, 0, 0] }],
      capabilities: ["script_eval"],
    }),
    "TNW-B/scripts/main.js": "export function main() {}\n",
    "TNW-Patch-B/manifest.json": JSON.stringify({
      format_version: 2,
      header: { name: "Patch", description: "Patch", uuid: "74747474-7474-7474-7474-747474747474", version: [1, 0, 0] },
      modules: [{ type: "script", entry: "main.js", uuid: behaviorUuid, version: [1, 0, 0] }],
      dependencies: [{ module_name: "mojang-minecraft", version: "0.1.0" }],
    }),
    "TNW-Patch-B/scripts/main.js": "import * as server from 'mojang-minecraft';\nexport function patch() {}\n",
    "TNW-R/manifest.json": JSON.stringify({
      format_version: 2,
      header: { name: "Resources", description: "Resources", uuid: resourceUuid, version: [1, 0, 0] },
      modules: [{ type: "resources", uuid: "75757575-7575-7575-7575-757575757575", version: [1, 0, 0] }],
      dependencies: [{ uuid: behaviorUuid, version: [1, 0, 0] }],
    }),
    "TNW-R/texts/en_US.lang": "item.tnw.name=Test item\n",
    "TNW-R/textures/blocks/example.texture_set.json": JSON.stringify({ format_version: "1.16.100", "minecraft:texture_set": { color: "example" } }),
    "TNW-R/sounds/sound_definitions.json": JSON.stringify({
      format_version: "1.20.20",
      sound_definitions: { example: { category: "block", sounds: ["sounds/example/one"] } },
    }),
    "TNW-R/disabled.json": '/* { "disabled": true } */',
    "TNW-R/notes.txt": "Keep this ordinary note.\n",
    "TNW-R/disabled-feature.txt": JSON.stringify({
      format_version: "1.13.0",
      "minecraft:structure_template_feature": { description: { identifier: "test:disabled" } },
    }),
    "TNW-R/disabled-invalid-feature.txt": '{ "format_version": "1.13.0", "minecraft:feature_rules": {}, }',
    "TNW-R/pack_icon.png": new Uint8Array([
      137, 80, 78, 71, 13, 10, 26, 10,
      0, 0, 0, 13, 73, 72, 68, 82,
      0, 0, 4, 25, 0, 0, 4, 25,
    ]),
  });

  const project = await analyzeArchive(file);
  translate(project, { "Test item": "テストアイテム" });
  const { zip, filename } = await outputZip(project);
  assert.equal(filename, "TNW-like.ja_JP.mcaddon");
  assert.equal((await validateBedrockAddonArchive(zip)).valid, true);
  assert.equal(zip.file("TNW-B/manifest.json"), null);
  const behaviorPack = await JSZip.loadAsync(await zip.file("TNW-B.mcpack").async("uint8array"), { checkCRC32: true });
  const patchPack = await JSZip.loadAsync(await zip.file("TNW-Patch-B.mcpack").async("uint8array"), { checkCRC32: true });
  const resourcePack = await JSZip.loadAsync(await zip.file("TNW-R.mcpack").async("uint8array"), { checkCRC32: true });

  const behaviorManifest = JSON.parse(await behaviorPack.file("manifest.json").async("string"));
  const patchManifest = JSON.parse(await patchPack.file("manifest.json").async("string"));
  assert.equal(behaviorManifest.modules[0].language, "javascript");
  assert.deepEqual(behaviorManifest.capabilities, ["script_eval"]);
  assert.equal(patchManifest.modules[0].language, "javascript");
  assert.equal(patchManifest.modules[0].entry, "scripts/main.js");
  assert.notEqual(patchManifest.modules[0].uuid, behaviorUuid);
  assert.deepEqual(patchManifest.dependencies, [{ module_name: "mojang-minecraft", version: "0.1.0" }]);
  assert.match(await patchPack.file("scripts/main.js").async("string"), /mojang-minecraft/);
  const resourceManifest = JSON.parse(await resourcePack.file("manifest.json").async("string"));
  assert.equal(resourceManifest.capabilities, undefined);
  assert.ok(resourcePack.file("pack_icon.png"));
  assert.ok(resourcePack.file("textures/blocks/example.texture_set.json"));
  assert.deepEqual(
    JSON.parse(await resourcePack.file("sounds/sound_definitions.json").async("string")).sound_definitions.example.sounds,
    ["sounds/example/one"],
  );
  assert.ok(resourcePack.file("disabled.json"));
  assert.ok(resourcePack.file("disabled-feature.txt"));
  assert.ok(resourcePack.file("disabled-invalid-feature.txt"));
  assert.match(await resourcePack.file("notes.txt").async("string"), /ordinary note/);
});

test("single-language Add-ons without languages.json are marked as uncertain", async () => {
  const resource = new JSZip();
  resource.file("manifest.json", JSON.stringify({
    format_version: 2,
    header: { name: "Legacy Resource", uuid: "91919191-9191-9191-9191-919191919191", version: [1, 0, 0] },
    modules: [{ type: "resources", uuid: "92929292-9292-9292-9292-929292929292", version: [1, 0, 0] }],
  }));
  resource.file("texts/en_US.lang", "entity.legacy.name=Legacy Creature\n");
  const file = await archiveFile("Legacy.mcaddon", {
    "Legacy-Resources.mcpack": await resource.generateAsync({ type: "uint8array" }),
  });

  const project = await analyzeArchive(file);
  assert.deepEqual(project.documents[0].localizationEvidence, {
    confirmed: false,
    languageFileCount: 1,
    languagesJson: "missing",
    declaredLocales: [],
  });
});

test("multiple Bedrock language files confirm language switching without languages.json", async () => {
  const resource = new JSZip();
  resource.file("manifest.json", JSON.stringify({
    format_version: 2,
    header: { name: "Multilingual Resource", uuid: "93939393-9393-9393-9393-939393939393", version: [1, 0, 0] },
    modules: [{ type: "resources", uuid: "94949494-9494-9494-9494-949494949494", version: [1, 0, 0] }],
  }));
  resource.file("texts/en_US.lang", "entity.multi.name=Creature\n");
  resource.file("texts/fr_FR.lang", "entity.multi.name=Créature\n");
  const file = await archiveFile("Multilingual.mcaddon", {
    "Multilingual-Resources.mcpack": await resource.generateAsync({ type: "uint8array" }),
  });

  const project = await analyzeArchive(file);
  const evidence = project.documents.find((document) => document.sourceLocale === "en_us")
    ?.localizationEvidence;
  assert.deepEqual(evidence, {
    confirmed: true,
    languageFileCount: 2,
    languagesJson: "missing",
    declaredLocales: [],
  });
});

test("forced mcaddon output replaces the source lang but preserves omitted lines", async () => {
  const resource = new JSZip();
  resource.file("manifest.json", JSON.stringify({
    format_version: 2,
    header: { name: "Forced Resource", uuid: "13131313-1313-1313-1313-131313131313", version: [1, 0, 0] },
    modules: [{ type: "resources", uuid: "14141414-1414-1414-1414-141414141414", version: [1, 0, 0] }],
  }));
  resource.file("texts/languages.json", JSON.stringify(["en_US"]));
  resource.file(
    "texts/en_US.lang",
    "entity.example.name=Example Creature\nentity.example.note=Keep this original\n",
  );
  const file = await archiveFile("Forced.mcaddon", {
    "Forced-Resources.mcpack": await resource.generateAsync({ type: "uint8array" }),
  });
  const project = await analyzeArchive(file);
  const translated = project.entries.find((entry) => entry.source === "Example Creature");
  translated.translation = "サンプルの生物";
  translated.status = "edited";
  const omitted = project.entries.find((entry) => entry.source === "Keep this original");
  omitted.ignored = true;

  const { zip, filename } = await outputZip(project, {
    bedrockTranslationMode: "forced",
  });
  assert.match(filename, /\.ja_JP\.forced\.mcaddon$/);
  const rebuilt = await JSZip.loadAsync(
    await zip.file("Forced-Resources.mcpack").async("uint8array"),
  );
  const sourceLang = await rebuilt.file("texts/en_US.lang").async("string");
  const targetLang = await rebuilt.file("texts/ja_JP.lang").async("string");
  assert.match(sourceLang, /entity\.example\.name=サンプルの生物/);
  assert.match(sourceLang, /entity\.example\.note=Keep this original/);
  assert.match(targetLang, /entity\.example\.name=サンプルの生物/);
  assert.doesNotMatch(targetLang, /Keep this original/);
  assert.deepEqual(
    JSON.parse(await rebuilt.file("texts/languages.json").async("string")),
    ["en_US", "ja_JP"],
  );
});

test("mcaddon converts nested Bedrock zip files to normalized mcpacks", async () => {
  const resourceUuid = "55555555-5555-5555-5555-555555555555";
  const resource = new JSZip();
  resource.file("ExampleR/manifest.json", JSON.stringify({
    format_version: 2,
    header: { name: "Resource", uuid: resourceUuid, version: [3, 2, 1] },
    modules: [{ type: "resources", uuid: "66666666-6666-6666-6666-666666666666", version: [1, 0, 0] }],
  }));
  resource.file("ExampleR/texts/languages.json", JSON.stringify(["en_US"]));
  resource.file("ExampleR/texts/en_US.lang", "entity.example.name=Example Creature\n");
  const behavior = new JSZip();
  behavior.file("ExampleB/manifest.json", JSON.stringify({
    format_version: 2,
    header: { name: "Behavior", uuid: "77777777-7777-7777-7777-777777777777", version: [3, 2, 1] },
    modules: [{ type: "data", uuid: "88888888-8888-8888-8888-888888888888", version: [1, 0, 0] }],
    dependencies: [{ uuid: resourceUuid, version: [3, 2, 1] }],
  }));
  const unrelated = new JSZip();
  unrelated.file("notes/readme.txt", "This is not a Bedrock pack.");
  const file = await archiveFile("Zipped.mcaddon", {
    "ExampleR.zip": await resource.generateAsync({ type: "uint8array" }),
    "ExampleB.zip": await behavior.generateAsync({ type: "uint8array" }),
    "Unrelated.zip": await unrelated.generateAsync({ type: "uint8array" }),
  });

  const project = await analyzeArchive(file);
  assert.equal(project.artifactType, "bedrock_addon");
  assert.equal(project.entries.length, 1);
  assert.deepEqual(
    project.artifactState.containers.map((container) => container.entryPath).filter(Boolean).sort(),
    ["ExampleB.zip", "ExampleR.zip"],
  );
  translate(project, { "Example Creature": "サンプルの生物" });
  const { zip } = await outputZip(project);
  assert.equal(zip.file("ExampleR.zip"), null);
  assert.equal(zip.file("ExampleB.zip"), null);
  const rebuiltResource = await JSZip.loadAsync(await zip.file("ExampleR.mcpack").async("uint8array"), { checkCRC32: true });
  const rebuiltBehavior = await JSZip.loadAsync(await zip.file("ExampleB.mcpack").async("uint8array"), { checkCRC32: true });
  assert.ok(rebuiltResource.file("manifest.json"));
  assert.ok(rebuiltBehavior.file("manifest.json"));
  assert.match(await rebuiltResource.file("texts/ja_JP.lang").async("string"), /サンプルの生物/);
  assert.deepEqual(
    JSON.parse(await rebuiltResource.file("manifest.json").async("string")).header.version,
    [3, 2, 1],
  );
  const resourceManifest = JSON.parse(await rebuiltResource.file("manifest.json").async("string"));
  const behaviorManifest = JSON.parse(await rebuiltBehavior.file("manifest.json").async("string"));
  assert.equal(behaviorManifest.dependencies[0].uuid, resourceManifest.header.uuid);
  assert.deepEqual(behaviorManifest.dependencies[0].version, [3, 2, 1]);
  assert.ok(zip.file("Unrelated.zip"));
  assert.equal((await validateBedrockAddonArchive(zip, { requirePackArchives: true })).valid, true);
});

test("mcaddon normalizes unchanged wrapped pack archives", async () => {
  const behavior = new JSZip();
  behavior.file("StandaloneB/manifest.json", JSON.stringify({
    format_version: 2,
    header: {
      name: "Standalone Behavior",
      uuid: "99999999-9999-9999-9999-999999999999",
      version: [1, 0, 0],
    },
    modules: [{
      type: "data",
      uuid: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      version: [1, 0, 0],
    }],
  }));
  behavior.file("StandaloneB/functions/setup.mcfunction", "say ready\n");
  const file = await archiveFile("Standalone.mcaddon", {
    "StandaloneB.zip": await behavior.generateAsync({ type: "uint8array" }),
  });

  const project = await analyzeArchive(file);
  assert.equal(project.artifactType, "bedrock_addon");
  assert.equal(project.entries.length, 0);
  const { zip } = await outputZip(project);
  assert.equal(zip.file("StandaloneB.zip"), null);
  const rebuilt = await JSZip.loadAsync(
    await zip.file("StandaloneB.mcpack").async("uint8array"),
    { checkCRC32: true },
  );
  assert.ok(rebuilt.file("manifest.json"));
  assert.ok(rebuilt.file("functions/setup.mcfunction"));
  assert.equal((await validateBedrockAddonArchive(zip, { requirePackArchives: true })).valid, true);
});

test("mcaddon exports use fresh linked UUIDs without version regression", async () => {
  const resourceUuid = "11111111-1111-1111-1111-111111111111";
  const behaviorUuid = "33333333-3333-3333-3333-333333333333";
  const resource = new JSZip();
  resource.file("manifest.json", JSON.stringify({
    format_version: 2,
    header: { name: "Resource", uuid: resourceUuid, version: [1, 0, 0] },
    modules: [{ type: "resources", uuid: "22222222-2222-2222-2222-222222222222", version: [1, 0, 0] }],
  }));
  resource.file("texts/en_US.lang", "entity.example.name=Example Creature\n");
  const behavior = new JSZip();
  behavior.file("manifest.json", JSON.stringify({
    format_version: 2,
    header: { name: "Behavior", uuid: behaviorUuid, version: [1, 0, 0] },
    modules: [{ type: "data", uuid: "44444444-4444-4444-4444-444444444444", version: [1, 0, 0] }],
    dependencies: [{ uuid: resourceUuid, version: [1, 0, 0] }],
  }));
  const file = await archiveFile("Linked.mcaddon", {
    "Linked-Resources.mcpack": await resource.generateAsync({ type: "uint8array" }),
    "Linked-Behavior.mcpack": await behavior.generateAsync({ type: "uint8array" }),
  });
  const project = await analyzeArchive(file);
  translate(project, { "Example Creature": "サンプルの生物" });
  const { zip } = await outputZip(project);
  const rebuiltResource = await JSZip.loadAsync(await zip.file("Linked-Resources.mcpack").async("uint8array"));
  const rebuiltBehavior = await JSZip.loadAsync(await zip.file("Linked-Behavior.mcpack").async("uint8array"));
  const resourceManifest = JSON.parse(await rebuiltResource.file("manifest.json").async("string"));
  const behaviorManifest = JSON.parse(await rebuiltBehavior.file("manifest.json").async("string"));
  assert.notEqual(resourceManifest.header.uuid, resourceUuid);
  assert.notEqual(behaviorManifest.header.uuid, behaviorUuid);
  assert.equal(behaviorManifest.dependencies[0].uuid, resourceManifest.header.uuid);
  assert.deepEqual(resourceManifest.header.version, [1, 0, 0]);
  assert.deepEqual(behaviorManifest.header.version, [1, 0, 0]);
  assert.deepEqual(behaviorManifest.dependencies[0].version, [1, 0, 0]);

  const second = await outputZip(project);
  const secondResource = await JSZip.loadAsync(await second.zip.file("Linked-Resources.mcpack").async("uint8array"));
  const secondManifest = JSON.parse(await secondResource.file("manifest.json").async("string"));
  assert.notEqual(secondManifest.header.uuid, resourceManifest.header.uuid);
});

test("Bedrock worlds translate embedded packs while preserving LevelDB bytes", async () => {
  const file = await archiveFile("Adventure.mcworld", {
    "Adventure/level.dat": new Uint8Array([8, 0, 0, 0]),
    "Adventure/db/CURRENT": "MANIFEST-000001\n",
    "Adventure/resource_packs/story/manifest.json": JSON.stringify({ format_version: 2, header: { name: "Story", uuid: "11111111-1111-1111-1111-111111111111", version: [1, 0, 0] }, modules: [{ type: "resources", uuid: "22222222-2222-2222-2222-222222222222", version: [1, 0, 0] }] }),
    "Adventure/resource_packs/story/texts/en_US.lang": "story.welcome=Welcome traveler\n",
  });
  const project = await analyzeArchive(file);
  assert.equal(project.artifactType, "bedrock_world");
  translate(project, { "Welcome traveler": "旅人よ、ようこそ" });
  const resultArchive = await outputZip(project);
  const { zip } = resultArchive;
  assert.ok(zip.file("level.dat"));
  assert.equal(await zip.file("db/CURRENT").async("string"), "MANIFEST-000001\n");
  assert.match(await zip.file("resource_packs/story/texts/ja_JP.lang").async("string"), /旅人よ/);
  assert.deepEqual(JSON.parse(await zip.file("resource_packs/story/manifest.json").async("string")).header.version, [1, 0, 0]);
  assert.equal(
    (await analyzeArchive(new File([resultArchive.archive], resultArchive.filename))).artifactType,
    "bedrock_world",
  );
});

test("forced Bedrock world output replaces lang files inside embedded Add-ons", async () => {
  const file = await archiveFile("ForcedWorld.mcworld", {
    "level.dat": new Uint8Array([8, 0, 0, 0]),
    "db/CURRENT": "MANIFEST-000001\n",
    "resource_packs/story/manifest.json": JSON.stringify({
      format_version: 2,
      header: { name: "Story", uuid: "15151515-1515-1515-1515-151515151515", version: [1, 0, 0] },
      modules: [{ type: "resources", uuid: "16161616-1616-1616-1616-161616161616", version: [1, 0, 0] }],
    }),
    "resource_packs/story/texts/en_US.lang": "story.welcome=Welcome traveler\n",
  });
  const project = await analyzeArchive(file);
  translate(project, { "Welcome traveler": "旅人よ、ようこそ" });
  const { zip, filename } = await outputZip(project, {
    bedrockTranslationMode: "forced",
  });
  assert.match(filename, /\.ja_JP\.forced\.mcworld$/);
  assert.match(
    await zip.file("resource_packs/story/texts/en_US.lang").async("string"),
    /旅人よ、ようこそ/,
  );
  assert.match(
    await zip.file("resource_packs/story/texts/ja_JP.lang").async("string"),
    /旅人よ、ようこそ/,
  );
  assert.equal(await zip.file("db/CURRENT").async("string"), "MANIFEST-000001\n");
});

test("Bedrock worlds translate commands and nested pack archives", async () => {
  const resources = new JSZip();
  resources.file("manifest.json", JSON.stringify({
    format_version: 2,
    header: { name: "Quest Resources", uuid: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", version: [1, 0, 0] },
    modules: [{ type: "resources", uuid: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", version: [1, 0, 0] }],
  }));
  resources.file("texts/en_US.lang", "quest.guide=Quest guide\n");
  const file = await archiveFile("Quest.mcworld", {
    "Quest/level.dat": new Uint8Array([8, 0, 0, 0]),
    "Quest/db/CURRENT": "MANIFEST-000001\n",
    "Quest/behavior_packs/quest/functions/start.mcfunction": 'titleraw @a title {"rawtext":[{"text":"Welcome hero"}]}\n',
    "Quest/resource_packs/quest.mcpack": await resources.generateAsync({ type: "uint8array" }),
  });
  const project = await analyzeArchive(file);
  assert.equal(project.artifactType, "bedrock_world");
  assert.ok(project.entries.some((entry) => entry.source === "Welcome hero"));
  assert.ok(project.entries.some((entry) => entry.source === "Quest guide"));
  translate(project, { "Welcome hero": "勇者よ、ようこそ", "Quest guide": "クエストガイド" });
  const resultArchive = await outputZip(project);
  const { zip } = resultArchive;
  assert.match(
    await zip.file("behavior_packs/quest/functions/start.mcfunction").async("string"),
    /勇者よ、ようこそ/,
  );
  const rebuilt = await JSZip.loadAsync(
    await zip.file("resource_packs/quest.mcpack").async("uint8array"),
  );
  assert.match(await rebuilt.file("texts/ja_JP.lang").async("string"), /クエストガイド/);
  assert.equal(await zip.file("db/CURRENT").async("string"), "MANIFEST-000001\n");
});

test("forced Bedrock world output also replaces lang inside nested mcpack files", async () => {
  const resources = new JSZip();
  resources.file("manifest.json", JSON.stringify({
    format_version: 2,
    header: { name: "Nested", uuid: "17171717-1717-1717-1717-171717171717", version: [1, 0, 0] },
    modules: [{ type: "resources", uuid: "18181818-1818-1818-1818-181818181818", version: [1, 0, 0] }],
  }));
  resources.file("texts/en_US.lang", "quest.guide=Quest guide\n");
  const file = await archiveFile("NestedWorld.mcworld", {
    "level.dat": new Uint8Array([8, 0, 0, 0]),
    "db/CURRENT": "MANIFEST-000001\n",
    "resource_packs/quest.mcpack": await resources.generateAsync({ type: "uint8array" }),
  });
  const project = await analyzeArchive(file);
  translate(project, { "Quest guide": "クエストガイド" });
  const { zip } = await outputZip(project, { bedrockTranslationMode: "forced" });
  const rebuilt = await JSZip.loadAsync(
    await zip.file("resource_packs/quest.mcpack").async("uint8array"),
  );
  assert.match(await rebuilt.file("texts/en_US.lang").async("string"), /クエストガイド/);
  assert.match(await rebuilt.file("texts/ja_JP.lang").async("string"), /クエストガイド/);
});

test("Bedrock worlds translate LevelDB text through a checksummed additive log", async () => {
  const key = new TextEncoder().encode("actorprefix-test-npc");
  const sourceValue = encodeNbtSequence([{
    type: NBT_TAG.COMPOUND,
    name: "",
    value: [
      { type: NBT_TAG.STRING, name: "identifier", value: "minecraft:npc" },
      { type: NBT_TAG.STRING, name: "CustomName", value: "Village Guide" },
      { type: NBT_TAG.STRING, name: "InteractiveText", value: JSON.stringify({ rawtext: [{ text: "Welcome traveler" }] }) },
    ],
  }], { littleEndian: true, stringEncoding: "utf8" });
  const sourceLog = buildLevelDbWriteLog([{ key, value: sourceValue }], 1n);
  const manifest = buildLevelDbManifestLog({
    logNumber: 2n,
    nextFileNumber: 3n,
    lastSequence: 1n,
  });
  const file = await archiveFile("NpcWorld.mcworld", {
    "level.dat": new Uint8Array([8, 0, 0, 0]),
    "db/CURRENT": "MANIFEST-000001\n",
    "db/MANIFEST-000001": manifest,
    "db/000002.log": sourceLog,
  });

  const project = await analyzeArchive(file);
  assert.equal(project.artifactType, "bedrock_world");
  assert.ok(project.entries.some((entry) => entry.source === "Village Guide"));
  assert.ok(project.entries.some((entry) => entry.source === "Welcome traveler"));
  translate(project, {
    "Village Guide": "村の案内人",
    "Welcome traveler": "旅人よ、ようこそ",
  });
  const { zip } = await outputZip(project);
  assert.deepEqual(
    await zip.file("db/MANIFEST-000001").async("uint8array"),
    manifest,
  );
  assert.deepEqual(await zip.file("db/000002.log").async("uint8array"), sourceLog);
  const patch = await zip.file("db/000003.log").async("uint8array");
  const updates = decodeLevelDbWriteLog(patch);
  assert.equal(updates.length, 1);
  assert.deepEqual(updates[0].key, key);
  assert.equal(updates[0].sequence, 2n);
  const roots = decodeNbtSequence(updates[0].value, {
    littleEndian: true,
    stringEncoding: "utf8",
  });
  const customName = roots[0].value.find((tag) => tag.name === "CustomName");
  const interactive = roots[0].value.find((tag) => tag.name === "InteractiveText");
  assert.equal(customName.value, "村の案内人");
  assert.equal(JSON.parse(interactive.value).rawtext[0].text, "旅人よ、ようこそ");

  const recovered = await readLevelDb([
    ["MANIFEST-000001", manifest],
    ["000002.log", sourceLog],
    ["000003.log", patch],
  ].map(([name, bytes]) => ({
    name,
    arrayBuffer: async () => bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ),
  })));
  const recoveredRecord = Object.values(recovered).find(
    (record) => record && record.keyBytes && Buffer.from(record.keyBytes).equals(Buffer.from(key)),
  );
  const recoveredRoots = decodeNbtSequence(recoveredRecord.value, {
    littleEndian: true,
    stringEncoding: "utf8",
  });
  assert.equal(
    recoveredRoots[0].value.find((tag) => tag.name === "CustomName").value,
    "村の案内人",
  );
});

test("Bedrock worlds distributed as zip download as mcworld", async () => {
  const file = await archiveFile("SharedWorld.zip", {
    "level.dat": new Uint8Array([8, 0, 0, 0]),
    "db/CURRENT": "MANIFEST-000001\n",
    "resource_packs/story/manifest.json": JSON.stringify({
      format_version: 2,
      header: { name: "Story", uuid: "56565656-5656-5656-5656-565656565656", version: [1, 0, 0] },
      modules: [{ type: "resources", uuid: "78787878-7878-7878-7878-787878787878", version: [1, 0, 0] }],
    }),
    "resource_packs/story/texts/en_US.lang": "story.start=Start story\n",
  });
  const project = await analyzeArchive(file);
  translate(project, { "Start story": "物語を始める" });
  const { filename, zip } = await outputZip(project);
  assert.match(filename, /\.mcworld$/);
  assert.ok(zip.file("level.dat"));
  assert.match(
    await zip.file("resource_packs/story/texts/ja_JP.lang").async("string"),
    /物語を始める/,
  );
});

test("server plugins produce a translation patch instead of modifying the JAR", async () => {
  const file = await archiveFile("WelcomePlugin.jar", {
    "plugin.yml": "name: WelcomePlugin\nmain: example.Plugin\nversion: 1.0.0\n",
    "lang/en_US.yml": "welcome: '<green>Welcome, %player%</green>'\n",
    "example/Plugin.class": new Uint8Array([0xca, 0xfe, 0xba, 0xbe]),
  });
  const project = await analyzeArchive(file);
  assert.equal(project.artifactType, "server_plugin");
  translate(project, { "<green>Welcome, %player%</green>": "<green>ようこそ、%player%</green>" });
  const { zip, filename } = await outputZip(project);
  assert.match(filename, /plugin-translation\.zip$/);
  assert.equal(zip.file("example/Plugin.class"), null);
  assert.match(await zip.file("plugins/WelcomePlugin/lang/ja_jp.yml").async("string"), /%player%/);
});

test("server plugins support root Java message bundles and declared data-folder names", async () => {
  const file = await archiveFile("EssentialsX-2.21.2.jar", {
    "plugin.yml": "name: Essentials\nmain: com.earth2me.essentials.Essentials\nversion: 2.21.2\n",
    "messages.properties": "teleporting=Teleporting...\nwelcome=Welcome, {0}!\n",
    "messages_en.properties": "teleporting=Teleporting...\nwelcome=Welcome, {0}!\n",
    "messages_ja.properties": "teleporting=\u30c6レポート中...\n",
  });
  const project = await analyzeArchive(file);
  assert.equal(project.artifactType, "server_plugin");
  assert.equal(project.mod.name, "Essentials");
  assert.equal(project.documents.length, 1);
  assert.deepEqual(project.entries.map((entry) => entry.key), ["teleporting", "welcome"]);
  translate(project, { "Teleporting...": "テレポート中...", "Welcome, {0}!": "ようこそ、{0}さん！" });
  const { zip } = await outputZip(project);
  assert.equal(zip.file("plugins/EssentialsX-2.21.2/messages_ja.properties"), null);
  const messages = await zip.file("plugins/Essentials/messages_ja.properties").async("string");
  assert.match(messages, /teleporting=テレポート中/);
  assert.match(messages, /welcome=ようこそ、\{0\}さん！/);
});

test("Modrinth packs add one language overlay without rewriting nested MOD JARs", async () => {
  const mod = new JSZip();
  mod.file("fabric.mod.json", JSON.stringify({ schemaVersion: 1, id: "inside", version: "1.0.0" }));
  mod.file("assets/inside/lang/en_us.json", JSON.stringify({ "inside.title": "Inside Mod" }));
  mod.file("LICENSE.txt", "Uppercase license path");
  mod.file("license.txt", "Lowercase license path");
  const modBytes = await mod.generateAsync({ type: "uint8array" });
  const file = await archiveFile("Pack.mrpack", {
    "modrinth.index.json": JSON.stringify({ formatVersion: 1, game: "minecraft", name: "Pack", versionId: "1", files: [], dependencies: { minecraft: "1.21.1" } }),
    "overrides/mods/inside.jar": modBytes,
  });
  const project = await analyzeArchive(file);
  assert.equal(project.artifactType, "modpack");
  translate(project, { "Inside Mod": "内側のMOD" });
  const resultArchive = await outputZip(project);
  const { zip } = resultArchive;
  assert.deepEqual([...await zip.file("overrides/mods/inside.jar").async("uint8array")], [...modBytes]);
  const overlay = await JSZip.loadAsync(await zip.file("client-overrides/resourcepacks/BabelBreaker-ja_jp.zip").async("uint8array"));
  assert.equal(JSON.parse(await overlay.file("assets/inside/lang/ja_jp.json").async("string"))["inside.title"], "内側のMOD");
  const rebuilt = await analyzeArchive(new File([resultArchive.archive], resultArchive.filename));
  assert.equal(rebuilt.artifactType, "modpack");
  assert.equal(rebuilt.artifact.variant, "modrinth");
});

test("ModPack indexes can be supplemented with locally selected MOD JARs", async () => {
  const pack = await archiveFile("RemotePack.mrpack", {
    "modrinth.index.json": JSON.stringify({
      formatVersion: 1,
      game: "minecraft",
      name: "Remote Pack",
      versionId: "1",
      files: [{ path: "mods/local.jar", hashes: { sha1: "abc" }, downloads: ["https://example.invalid/local.jar"] }],
      dependencies: { minecraft: "1.21.1" },
    }),
  });
  const localMod = await archiveFile("Local.jar", {
    "fabric.mod.json": JSON.stringify({ schemaVersion: 1, id: "local", name: "Local MOD", version: "1.0.0" }),
    "assets/local/lang/en_us.json": JSON.stringify({ "local.title": "Local title" }),
  });
  const project = combineProjects([await analyzeArchive(pack), await analyzeArchive(localMod)]);
  assert.equal(project.artifactType, "modpack");
  assert.equal(project.artifactBatch, undefined);
  assert.equal(project.coverage.missingReferences, 0);
  assert.equal(project.coverage.suppliedLocalMods, 1);
  translate(project, { "Local title": "ローカルタイトル" });
  const { zip } = await outputZip(project);
  assert.equal(zip.file("mods/local.jar"), null);
  const overlay = await JSZip.loadAsync(await zip.file("client-overrides/resourcepacks/BabelBreaker-ja_jp.zip").async("uint8array"));
  assert.equal(JSON.parse(await overlay.file("assets/local/lang/ja_jp.json").async("string"))["local.title"], "ローカルタイトル");
});

test("CurseForge exports report manifest-only files and place the overlay in overrides", async () => {
  const mod = new JSZip();
  mod.file("assets/thirdparty/lang/en_us.json", JSON.stringify({ "thirdparty.name": "Third Party" }));
  const file = await archiveFile("CursePack.zip", {
    "manifest.json": JSON.stringify({ manifestType: "minecraftModpack", manifestVersion: 1, name: "Curse Pack", files: [{ projectID: 1, fileID: 10 }, { projectID: 2, fileID: 20 }] }),
    "overrides/mods/thirdparty.jar": await mod.generateAsync({ type: "uint8array" }),
  });
  const project = await analyzeArchive(file);
  assert.equal(project.artifact.variant, "curseforge");
  assert.equal(project.coverage.missingReferences, 1);
  translate(project, { "Third Party": "サードパーティ" });
  const resultArchive = await outputZip(project);
  const { zip } = resultArchive;
  assert.ok(zip.file("overrides/resourcepacks/BabelBreaker-ja_jp.zip"));
  const rebuilt = await analyzeArchive(new File([resultArchive.archive], resultArchive.filename));
  assert.equal(rebuilt.artifactType, "modpack");
  assert.equal(rebuilt.artifact.variant, "curseforge");
});

test("Java world archives rebuild nested resources.zip and keep world data", async () => {
  const resources = new JSZip();
  resources.file("pack.mcmeta", JSON.stringify({ pack: { pack_format: 34, description: "World resources" } }));
  resources.file("assets/world/lang/en_us.json", JSON.stringify({ "world.guide": "World Guide" }));
  const file = await archiveFile("Map.zip", {
    "level.dat": new Uint8Array([1, 2, 3]),
    "region/r.0.0.mca": new Uint8Array([4, 5, 6]),
    "resources.zip": await resources.generateAsync({ type: "uint8array" }),
  });
  const project = await analyzeArchive(file);
  assert.equal(project.artifactType, "java_world");
  translate(project, { "World Guide": "ワールドガイド" });
  const resultArchive = await outputZip(project);
  const { zip } = resultArchive;
  assert.deepEqual([...await zip.file("region/r.0.0.mca").async("uint8array")], [4, 5, 6]);
  const rebuilt = await JSZip.loadAsync(await zip.file("resources.zip").async("uint8array"));
  assert.equal(JSON.parse(await rebuilt.file("assets/world/lang/ja_jp.json").async("string"))["world.guide"], "ワールドガイド");
  assert.equal(
    (await analyzeArchive(new File([resultArchive.archive], resultArchive.filename))).artifactType,
    "java_world",
  );
});

test("Java worlds translate known sign text inside Anvil region chunks", async () => {
  const file = await archiveFile("SignWorld.zip", {
    "level.dat": new Uint8Array([1, 2, 3]),
    "region/r.0.0.mca": makeRegionWithSign(),
  });
  const project = await analyzeArchive(file);
  assert.equal(project.artifactType, "java_world");
  assert.ok(project.entries.some((entry) => entry.source === "Welcome traveler"));
  translate(project, { "Welcome traveler": "旅人よ、ようこそ", "Second line": "二行目" });
  const { zip } = await outputZip(project);
  const nbt = firstRegionChunk(await zip.file("region/r.0.0.mca").async("uint8array"));
  const blockEntities = nbt.root.value.find((tag) => tag.name === "block_entities").value.items;
  const frontText = blockEntities[0].find((tag) => tag.name === "front_text").value;
  const messages = frontText.find((tag) => tag.name === "messages").value.items;
  assert.equal(JSON.parse(messages[0]).text, "旅人よ、ようこそ");
  assert.equal(JSON.parse(messages[1]).text, "二行目");
});

test("Java worlds translate text stored in separate entity regions", async () => {
  const file = await archiveFile("EntityWorld.zip", {
    "level.dat": new Uint8Array([1, 2, 3]),
    "entities/r.0.0.mca": makeRegionWithSign(),
  });
  const project = await analyzeArchive(file);
  assert.equal(project.artifactType, "java_world");
  assert.ok(project.entries.some((entry) => entry.source === "Welcome traveler"));
  translate(project, { "Welcome traveler": "旅人よ、ようこそ", "Second line": "二行目" });
  const { zip } = await outputZip(project);
  const nbt = firstRegionChunk(await zip.file("entities/r.0.0.mca").async("uint8array"));
  const blockEntities = nbt.root.value.find((tag) => tag.name === "block_entities").value.items;
  const frontText = blockEntities[0].find((tag) => tag.name === "front_text").value;
  const messages = frontText.find((tag) => tag.name === "messages").value.items;
  assert.equal(JSON.parse(messages[0]).text, "旅人よ、ようこそ");
});

test("multiple package formats download as one bundle of native outputs", async () => {
  const resource = await archiveFile("UI.zip", {
    "pack.mcmeta": JSON.stringify({ pack: { pack_format: 34, description: "UI" } }),
    "assets/ui/lang/en_us.json": JSON.stringify({ "ui.ok": "Okay" }),
  });
  const data = await archiveFile("Rules.zip", {
    "pack.mcmeta": JSON.stringify({ pack: { pack_format: 48, description: "Rules" } }),
    "data/rules/advancement/start.json": JSON.stringify({ display: { title: { text: "Start" } } }),
  });
  const project = combineProjects([await analyzeArchive(resource), await analyzeArchive(data)]);
  assert.equal(project.artifactBatch, true);
  translate(project, { Okay: "決定", Start: "開始" });
  const { archive } = await buildResourcePack(project, project.minecraftVersion, "nodebuffer");
  const zip = await JSZip.loadAsync(archive);
  assert.ok(zip.file(/\.ja_jp\.zip$/).length >= 2);
});
