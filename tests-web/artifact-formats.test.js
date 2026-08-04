import assert from "node:assert/strict";
import { File } from "node:buffer";
import test from "node:test";
import JSZip from "jszip";

import { analyzeArchive, buildResourcePack, combineProjects } from "../src/core.js";
import { NBT_TAG, parseNbt, writeNbt } from "../src/nbt.js";

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

async function outputZip(project) {
  const result = await buildResourcePack(project, project.minecraftVersion, "nodebuffer");
  return { ...result, zip: await JSZip.loadAsync(result.archive) };
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
  const { zip } = await outputZip(project);
  assert.deepEqual(JSON.parse(await zip.file("assets/clean/lang/ja_jp.json").async("string")), { "menu.start": "ゲーム開始" });
  assert.equal(zip.file("assets/clean/textures/gui.png"), null);
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
  const { zip } = await outputZip(project);
  const result = JSON.parse(await zip.file("data/story/advancement/chapter.json").async("string"));
  assert.equal(result.display.title.text, "第一章");
  assert.equal(result.criteria.gate.trigger, "minecraft:location");
  const command = await zip.file("data/story/function/welcome.mcfunction").async("string");
  assert.match(command, /勇者よ、ようこそ/);
  assert.match(command, /give @a minecraft:book/);
});

test("Bedrock Add-ons update lang files and languages.json without changing UUIDs", async () => {
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
  assert.equal(outputManifest.header.uuid, manifest.header.uuid);
  assert.deepEqual(outputManifest.header.version, [1, 0, 1]);
  assert.deepEqual(outputManifest.modules[0].version, [1, 0, 1]);
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
  assert.deepEqual(JSON.parse(await zip.file("manifest.json").async("string")).header.version, [2, 3, 5]);
  assert.match(await zip.file("texts/ja_JP.lang").async("string"), /包まれたアイテム/);
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
  translate(project, { "Example Creature": "サンプルの生物" });
  const { zip } = await outputZip(project);
  const rebuilt = await JSZip.loadAsync(await zip.file("Creatures-Resources.mcpack").async("uint8array"));
  assert.match(await rebuilt.file("texts/ja_JP.lang").async("string"), /サンプルの生物/);
});

test("mcaddon versions and UUID dependencies stay consistent after a pack changes", async () => {
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
  assert.equal(resourceManifest.header.uuid, resourceUuid);
  assert.equal(behaviorManifest.header.uuid, behaviorUuid);
  assert.deepEqual(resourceManifest.header.version, [1, 0, 1]);
  assert.deepEqual(behaviorManifest.header.version, [1, 0, 1]);
  assert.deepEqual(behaviorManifest.dependencies[0].version, [1, 0, 1]);
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
  const { zip } = await outputZip(project);
  assert.ok(zip.file("level.dat"));
  assert.equal(await zip.file("db/CURRENT").async("string"), "MANIFEST-000001\n");
  assert.match(await zip.file("resource_packs/story/texts/ja_JP.lang").async("string"), /旅人よ/);
  assert.deepEqual(JSON.parse(await zip.file("resource_packs/story/manifest.json").async("string")).header.version, [1, 0, 0]);
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

test("Modrinth packs add one language overlay without rewriting nested MOD JARs", async () => {
  const mod = new JSZip();
  mod.file("fabric.mod.json", JSON.stringify({ schemaVersion: 1, id: "inside", version: "1.0.0" }));
  mod.file("assets/inside/lang/en_us.json", JSON.stringify({ "inside.title": "Inside Mod" }));
  const modBytes = await mod.generateAsync({ type: "uint8array" });
  const file = await archiveFile("Pack.mrpack", {
    "modrinth.index.json": JSON.stringify({ formatVersion: 1, game: "minecraft", name: "Pack", versionId: "1", files: [], dependencies: { minecraft: "1.21.1" } }),
    "overrides/mods/inside.jar": modBytes,
  });
  const project = await analyzeArchive(file);
  assert.equal(project.artifactType, "modpack");
  translate(project, { "Inside Mod": "内側のMOD" });
  const { zip } = await outputZip(project);
  assert.deepEqual([...await zip.file("overrides/mods/inside.jar").async("uint8array")], [...modBytes]);
  const overlay = await JSZip.loadAsync(await zip.file("client-overrides/resourcepacks/BabelBreaker-ja_jp.zip").async("uint8array"));
  assert.equal(JSON.parse(await overlay.file("assets/inside/lang/ja_jp.json").async("string"))["inside.title"], "内側のMOD");
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
  const { zip } = await outputZip(project);
  assert.ok(zip.file("overrides/resourcepacks/BabelBreaker-ja_jp.zip"));
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
  const { zip } = await outputZip(project);
  assert.deepEqual([...await zip.file("region/r.0.0.mca").async("uint8array")], [4, 5, 6]);
  const rebuilt = await JSZip.loadAsync(await zip.file("resources.zip").async("uint8array"));
  assert.equal(JSON.parse(await rebuilt.file("assets/world/lang/ja_jp.json").async("string"))["world.guide"], "ワールドガイド");
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
