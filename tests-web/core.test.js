import assert from "node:assert/strict";
import { File } from "node:buffer";
import test from "node:test";
import JSZip from "jszip";
import { NBT_TAG, parseNbt, writeNbt } from "../src/nbt.js";

import {
  analyzeArchive,
  applyClipboardTranslation,
  buildClipboardPayload,
  buildPackMetadata,
  buildResourcePack,
  buildTranslationRequest,
  combineProjects,
  createDemoProject,
  extractPlaceholderTokens,
  getProjectStats,
  getGameTargetLocale,
  parseGlossary,
  parseLegacyLang,
  placeholdersMatch,
  translateProject,
} from "../src/core.js";

async function makeModFile({
  name = "example-mod-1.21.1-1.0.0.jar",
  fabric = {
    schemaVersion: 1,
    id: "example",
    name: "Example Mod",
    version: "1.0.0",
    depends: { minecraft: ">=1.21.1" },
  },
  files = {
    "assets/example/lang/en_us.json": JSON.stringify({
      "item.example": "Example Item",
      "gui.energy": "Energy: %s / %s",
    }),
  },
} = {}) {
  const zip = new JSZip();
  if (fabric) zip.file("fabric.mod.json", JSON.stringify(fabric));
  for (const [path, contents] of Object.entries(files)) zip.file(path, contents);
  const archive = await zip.generateAsync({ type: "uint8array" });
  return new File([archive], name, { type: "application/java-archive" });
}

async function makeArchiveFile(name, files) {
  const zip = new JSZip();
  for (const [path, contents] of Object.entries(files)) zip.file(path, contents);
  const archive = await zip.generateAsync({ type: "uint8array" });
  return new File([archive], name, { type: "application/zip" });
}

test("legacy .lang parser preserves values after the first separator", () => {
  assert.deepEqual(
    parseLegacyLang("# comment\nitem.example=Example=Item\nmessage.test:Hello\ninvalid\n"),
    {
      "item.example": "Example=Item",
      "message.test": "Hello",
    },
  );
});

test("placeholder validation protects Minecraft formatting", () => {
  assert.deepEqual(
    extractPlaceholderTokens(
      "Energy: %1$s / %s §a{0} {player} $(bold)$() $(l:mod:entry)Guide$(/l)\n",
    ),
    [
    "\n",
    "$()",
    "$(/l)",
    "$(bold)",
    "$(l:mod:entry)",
    "%1$s",
    "%s",
    "{0}",
    "{player}",
    "§a",
    ],
  );
  assert.equal(placeholdersMatch("Hello %s", "こんにちは %s"), true);
  assert.equal(placeholdersMatch("Hello %s", "こんにちは"), false);
});

test("placeholder validation protects common server plugin markup", () => {
  const source = "<green>Hello %player%</green> &lRank {0,number} {user_name}";
  assert.deepEqual(extractPlaceholderTokens(source), [
    "%player%",
    "&l",
    "</green>",
    "<green>",
    "{0,number}",
    "{user_name}",
  ]);
  assert.equal(placeholdersMatch(source, "<green>ようこそ %player%</green> &lランク {0,number} {user_name}"), true);
  assert.equal(placeholdersMatch(source, "<green>ようこそ</green> &lランク {0,number} {user_name}"), false);
});

test("JAR analysis discovers metadata, multiple namespaces, and existing Japanese", async () => {
  const file = await makeModFile({
    files: {
      "assets/example/lang/en_us.json": JSON.stringify({
        "item.example": "Example Item",
        "gui.energy": "Energy: %s / %s",
      }),
      "assets/example/lang/ja_jp.json": JSON.stringify({
        "item.example": "サンプルアイテム",
      }),
      "assets/addon/lang/en_gb.json": JSON.stringify({
        "item.addon": "Addon Part",
      }),
    },
  });

  const project = await analyzeArchive(file);
  assert.equal(project.mod.name, "Example Mod");
  assert.equal(project.mod.loader, "Fabric");
  assert.equal(project.minecraftVersion, "1.21");
  assert.equal(project.namespaces.length, 2);
  assert.equal(getProjectStats(project).total, 3);
  assert.equal(getProjectStats(project).pending, 2);
  assert.equal(
    project.entries.find((entry) => entry.key === "item.example").translation,
    "サンプルアイテム",
  );
});

test("Patchouli books are extracted and exported as locale resource files", async () => {
  const file = await makeModFile({
    files: {
      "assets/example/patchouli_books/guide/en_us/categories/basics.json":
        JSON.stringify({
          name: "Basics",
          description: "Learn how the machines work.",
          icon: "minecraft:book",
        }),
      "assets/example/patchouli_books/guide/en_us/entries/first_steps.json":
        JSON.stringify({
          name: "First Steps",
          icon: "minecraft:crafting_table",
          category: "example:basics",
          pages: [
            {
              type: "patchouli:text",
              text: "Build the $(bold)Arcane Forge$() first.",
            },
          ],
        }),
      "assets/example/patchouli_books/guide/ja_jp/entries/first_steps.json":
        JSON.stringify({
          name: "最初の一歩",
        }),
    },
  });

  const project = await analyzeArchive(file);
  const patchouliEntries = project.entries.filter(
    (entry) => entry.contentKind === "patchouli",
  );
  assert.equal(patchouliEntries.length, 4);
  assert.ok(project.contentKinds.includes("patchouli"));
  assert.equal(project.requiresInstanceInstall, false);
  assert.equal(
    patchouliEntries.find((entry) => entry.source === "First Steps")
      .translation,
    "最初の一歩",
  );

  const translations = new Map([
    ["Basics", "基本"],
    ["Learn how the machines work.", "機械の仕組みを学びます。"],
    [
      "Build the $(bold)Arcane Forge$() first.",
      "最初に$(bold)秘術の鍛冶台$()を作ります。",
    ],
  ]);
  for (const entry of patchouliEntries) {
    if (!translations.has(entry.source)) continue;
    entry.translation = translations.get(entry.source);
    entry.status = "edited";
  }

  const { archive, filename } = await buildResourcePack(
    project,
    "1.21",
    "nodebuffer",
  );
  assert.doesNotMatch(filename, /translation_bundle/);
  const zip = await JSZip.loadAsync(archive);
  const category = JSON.parse(
    await zip
      .file(
        "assets/example/patchouli_books/guide/ja_jp/categories/basics.json",
      )
      .async("string"),
  );
  assert.equal(category.name, "基本");
  assert.equal(category.description, "機械の仕組みを学びます。");
  assert.equal(category.icon, "minecraft:book");
  const entry = JSON.parse(
    await zip
      .file(
        "assets/example/patchouli_books/guide/ja_jp/entries/first_steps.json",
      )
      .async("string"),
  );
  assert.equal(entry.name, "最初の一歩");
  assert.equal(
    entry.pages[0].text,
    "最初に$(bold)秘術の鍛冶台$()を作ります。",
  );
});

test("modpack Patchouli books are exported to their instance path", async () => {
  const file = await makeArchiveFile("GuidePack.zip", {
    "overrides/patchouli_books/pack_guide/book.json": JSON.stringify({
      name: "Pack Guide",
      landing_text: "Welcome",
    }),
    "overrides/patchouli_books/pack_guide/en_us/entries/start.json":
      JSON.stringify({
        name: "Welcome",
        pages: [{ type: "patchouli:text", text: "Read this first." }],
      }),
  });
  const project = await analyzeArchive(file);
  assert.equal(project.requiresInstanceInstall, true);
  assert.equal(project.entries.length, 4);
  project.entries.forEach((entry) => {
    entry.translation = new Map([
      ["Pack Guide", "パックガイド"],
      ["Welcome", "ようこそ"],
      ["Read this first.", "最初にお読みください。"],
    ]).get(entry.source);
    entry.status = "edited";
  });
  const { archive } = await buildResourcePack(
    project,
    "1.21",
    "nodebuffer",
  );
  const bundle = await JSZip.loadAsync(archive);
  const output = JSON.parse(
    await bundle
      .file(
        "instance/patchouli_books/pack_guide/ja_jp/entries/start.json",
      )
      .async("string"),
  );
  assert.equal(output.name, "ようこそ");
  assert.equal(output.pages[0].text, "最初にお読みください。");
  const book = JSON.parse(
    await bundle
      .file("instance/patchouli_books/pack_guide/book.json")
      .async("string"),
  );
  assert.equal(book.name, "パックガイド");
  assert.equal(book.landing_text, "ようこそ");
});

test("FTB Quests locale SNBT is exported as an instance translation bundle", async () => {
  const file = await makeArchiveFile("ExampleModpack.zip", {
    "assets/example/lang/en_us.json": JSON.stringify({
      "item.example.quest_book": "Quest Book",
    }),
    "overrides/config/ftbquests/quests/lang/en_us.snbt": `{
  "quest.start.title": "Getting Started"
  "quest.start.description": [
    "Welcome, {player}!"
    "[{\\"text\\":\\"Click here\\",\\"color\\":\\"green\\"}]"
  ]
}`,
    "overrides/config/ftbquests/quests/lang/ja_jp.snbt": `{
  "quest.start.title": "はじめに"
}`,
  });
  const project = await analyzeArchive(file);
  assert.equal(project.game, "minecraft");
  assert.equal(project.requiresInstanceInstall, true);
  assert.ok(project.contentKinds.includes("ftbquests"));
  assert.equal(project.entries.length, 4);
  assert.equal(
    project.entries.find((entry) => entry.source === "Getting Started")
      .translation,
    "はじめに",
  );

  for (const entry of project.entries) {
    if (entry.source === "Welcome, {player}!") {
      entry.translation = "ようこそ、{player}！";
      entry.status = "edited";
    }
    if (entry.source === "Click here") {
      entry.translation = "ここをクリック";
      entry.status = "edited";
    }
    if (entry.source === "Quest Book") {
      entry.translation = "クエストブック";
      entry.status = "edited";
    }
  }

  const { archive, filename } = await buildResourcePack(
    project,
    "1.21",
    "nodebuffer",
  );
  assert.match(filename, /translation_bundle\.zip$/);
  const bundle = await JSZip.loadAsync(archive);
  const translated = await bundle
    .file("instance/config/ftbquests/quests/lang/ja_jp.snbt")
    .async("string");
  assert.match(translated, /"quest\.start\.title": "はじめに"/);
  assert.match(translated, /"ようこそ、\{player\}！"/);
  assert.match(translated, /ここをクリック/);
  assert.match(translated, /\\"color\\":\\"green\\"/);
  const resourcePackPath = Object.keys(bundle.files).find((path) =>
    path.endsWith("_resourcepack.zip"),
  );
  assert.ok(resourcePackPath);
  const resourcePack = await JSZip.loadAsync(
    await bundle.file(resourcePackPath).async("uint8array"),
  );
  assert.deepEqual(
    JSON.parse(
      await resourcePack
        .file("assets/example/lang/ja_jp.json")
        .async("string"),
    ),
    { "item.example.quest_book": "クエストブック" },
  );
  assert.ok(bundle.file("README.txt"));
});

test("legacy FTB Quests translates visible fields and preserves commands", async () => {
  const file = await makeArchiveFile("LegacyFTBPack.zip", {
    "overrides/config/ftbquests/quests/chapters/start.snbt": `{
  title: "First Chapter"
  quests: [{
    title: "Gather Stone"
    description: ["Collect stone to continue."]
    command: "/give @p minecraft:stone"
    id: "1234ABCD"
  }]
}`,
  });
  const project = await analyzeArchive(file);
  assert.equal(project.entries.length, 3);
  assert.ok(
    project.entries.every((entry) => entry.contentKind === "ftbquests"),
  );
  const translations = new Map([
    ["First Chapter", "最初の章"],
    ["Gather Stone", "石を集める"],
    ["Collect stone to continue.", "石を集めて先へ進みます。"],
  ]);
  project.entries.forEach((entry) => {
    entry.translation = translations.get(entry.source);
    entry.status = "edited";
  });
  const { archive } = await buildResourcePack(
    project,
    "1.20",
    "nodebuffer",
  );
  const bundle = await JSZip.loadAsync(archive);
  const output = await bundle
    .file("instance/config/ftbquests/quests/chapters/start.snbt")
    .async("string");
  assert.match(output, /title: "最初の章"/);
  assert.match(output, /title: "石を集める"/);
  assert.match(output, /description: \["石を集めて先へ進みます。"\]/);
  assert.match(output, /command: "\/give @p minecraft:stone"/);
  assert.match(output, /id: "1234ABCD"/);
});

test("binary FTB Quests NBT translates visible strings without changing quest data", async () => {
  const binaryQuest = writeNbt({
    compression: "gzip",
    root: {
      type: NBT_TAG.COMPOUND,
      name: "",
      value: [
        { type: NBT_TAG.STRING, name: "title", value: "Binary Quest" },
        {
          type: NBT_TAG.LIST,
          name: "description",
          value: {
            elementType: NBT_TAG.STRING,
            items: [
              "Collect ten stones.",
              '{"text":"Click here","color":"green","clickEvent":{"action":"run_command","value":"/say quest"}}',
            ],
          },
        },
        {
          type: NBT_TAG.STRING,
          name: "command",
          value: "/give @p minecraft:stone",
        },
        {
          type: NBT_TAG.STRING,
          name: "name",
          value: "quest.binary.internal_name",
        },
        { type: NBT_TAG.LONG, name: "id", value: 1234567890123456789n },
        {
          type: NBT_TAG.INT_ARRAY,
          name: "progress",
          value: new Int32Array([1, 2, 3]),
        },
      ],
    },
  });
  const file = await makeArchiveFile("BinaryFTBPack.zip", {
    "overrides/config/ftbquests/quests/chapters/start.nbt": binaryQuest,
  });

  const project = await analyzeArchive(file);
  assert.equal(project.entries.length, 3);
  assert.ok(
    project.entries.every(
      (entry) => entry.contentFormat === "ftbquests-binary-nbt",
    ),
  );
  const translations = new Map([
    ["Binary Quest", "バイナリクエスト"],
    ["Collect ten stones.", "石を10個集めます。"],
    ["Click here", "ここをクリック"],
  ]);
  project.entries.forEach((entry) => {
    entry.translation = translations.get(entry.source);
    entry.status = "edited";
  });

  const { archive } = await buildResourcePack(
    project,
    "1.20",
    "nodebuffer",
  );
  const bundle = await JSZip.loadAsync(archive);
  const outputBytes = await bundle
    .file("instance/config/ftbquests/quests/chapters/start.nbt")
    .async("uint8array");
  const output = parseNbt(outputBytes);
  assert.equal(output.compression, "gzip");
  const tags = new Map(output.root.value.map((tag) => [tag.name, tag]));
  assert.equal(tags.get("title").value, "バイナリクエスト");
  assert.equal(tags.get("description").value.items[0], "石を10個集めます。");
  assert.deepEqual(JSON.parse(tags.get("description").value.items[1]), {
    text: "ここをクリック",
    color: "green",
    clickEvent: { action: "run_command", value: "/say quest" },
  });
  assert.equal(tags.get("command").value, "/give @p minecraft:stone");
  assert.equal(tags.get("name").value, "quest.binary.internal_name");
  assert.equal(tags.get("id").value, 1234567890123456789n);
  assert.deepEqual([...tags.get("progress").value], [1, 2, 3]);
});

test("legacy Better Questing JSON is translated without changing quest data", async () => {
  const file = await makeArchiveFile("LegacyPack.zip", {
    "overrides/config/betterquesting/DefaultQuests.json": JSON.stringify({
      "questDatabase:9": {
        "0:10": {
          "properties:10": {
            "betterquesting:10": {
              "name:8": "A New Beginning",
              "desc:8": "Collect ten stones.",
              "questID:3": 42,
            },
          },
        },
      },
    }),
  });
  const project = await analyzeArchive(file);
  assert.ok(project.contentKinds.includes("betterquesting"));
  assert.equal(project.entries.length, 2);
  for (const entry of project.entries) {
    entry.translation =
      entry.source === "A New Beginning" ? "新たな始まり" : "石を10個集めます。";
    entry.status = "edited";
  }

  const { archive } = await buildResourcePack(
    project,
    "1.12",
    "nodebuffer",
  );
  const bundle = await JSZip.loadAsync(archive);
  const output = JSON.parse(
    await bundle
      .file("instance/config/betterquesting/DefaultQuests.json")
      .async("string"),
  );
  const quest = output["questDatabase:9"]["0:10"]["properties:10"][
    "betterquesting:10"
  ];
  assert.equal(quest["name:8"], "新たな始まり");
  assert.equal(quest["desc:8"], "石を10個集めます。");
  assert.equal(quest["questID:3"], 42);
});

test("JAR analysis preserves the selected target locale instead of Japanese", async () => {
  const file = await makeModFile({
    files: {
      "assets/example/lang/en_us.json": JSON.stringify({
        "item.example": "Example Item",
        "item.second": "Second Item",
      }),
      "assets/example/lang/de_de.json": JSON.stringify({
        "item.example": "Beispielgegenstand",
      }),
      "assets/example/lang/ja_jp.json": JSON.stringify({
        "item.example": "サンプルアイテム",
      }),
    },
  });

  const project = await analyzeArchive(file, { targetLanguage: "de" });
  assert.equal(project.targetLanguage, "de");
  assert.equal(project.targetLocale, "de_de");
  assert.equal(project.entries[0].translation, "Beispielgegenstand");
  assert.equal(getProjectStats(project).pending, 1);
});

test("JAR analysis detects non-English source languages from Minecraft locales", async () => {
  const project = await analyzeArchive(
    await makeModFile({
      files: {
        "assets/example/lang/fr_fr.json": JSON.stringify({
          "item.example": "Objet magique",
        }),
      },
    }),
  );

  assert.equal(project.sourceLanguage, "fr");
  assert.deepEqual(project.sourceLanguages, ["fr"]);
  assert.deepEqual(project.unsupportedSourceLocales, []);
  assert.equal(project.namespaces[0].sourceLanguage, "fr");
  assert.equal(project.entries[0].sourceLanguage, "fr");
  assert.equal(project.entries[0].sourceLocale, "fr_fr");
});

test("JAR analysis tracks different source languages per namespace", async () => {
  const project = await analyzeArchive(
    await makeModFile({
      files: {
        "assets/example/lang/de_de.json": JSON.stringify({ item: "Gegenstand" }),
        "assets/addon/lang/es_es.json": JSON.stringify({ addon: "Accesorio" }),
      },
    }),
  );

  assert.equal(project.sourceLanguage, null);
  assert.deepEqual(new Set(project.sourceLanguages), new Set(["de", "es"]));
  assert.deepEqual(
    project.entries.map((entry) => entry.sourceLanguage),
    ["de", "es"],
  );
});

test("Factorio locale CFG is exported inside a complete translated mod ZIP", async () => {
  const project = await analyzeArchive(
    await makeArchiveFile("example-factorio_1.0.0.zip", {
      "example-factorio_1.0.0/info.json": JSON.stringify({
        name: "example-factorio",
        title: "Example Factorio Mod",
        version: "1.0.0",
      }),
      "example-factorio_1.0.0/locale/en/base.cfg":
        "[item-name]\nexample-item=Example item\n\n[mod-setting-name]\nexample=Example setting\n",
    }),
  );

  assert.equal(project.game, "factorio");
  assert.equal(project.mod.name, "Example Factorio Mod");
  assert.equal(project.targetLocale, "ja");
  assert.equal(project.entries.length, 2);
  project.entries.forEach((entry) => {
    entry.translation = `訳:${entry.source}`;
    entry.status = "edited";
  });

  const { archive, filename } = await buildResourcePack(project, undefined, "nodebuffer");
  const zip = await JSZip.loadAsync(archive, { checkCRC32: true });
  const output = await zip
    .file("example-factorio_1.0.0/locale/ja/base.cfg")
    .async("string");
  assert.match(output, /\[item-name\]\nexample-item=訳:Example item/);
  assert.ok(zip.file("example-factorio_1.0.0/info.json"));
  assert.ok(
    zip.file("example-factorio_1.0.0/_BABEL_BREAKER_README.txt"),
  );
  const rebuilt = await analyzeArchive(new File([archive], filename));
  assert.equal(rebuilt.game, "factorio");
  assert.equal(rebuilt.mod.id, "example-factorio");
});

test("Stardew Valley i18n is exported inside a complete translated mod ZIP", async () => {
  const project = await analyzeArchive(
    await makeArchiveFile("ExampleStardew.zip", {
      "ExampleStardew/manifest.json": JSON.stringify({
        Name: "Example Stardew Mod",
        UniqueID: "Example.Author.Mod",
        Version: "2.0.0",
      }),
      "ExampleStardew/i18n/default.json": JSON.stringify({
        greeting: "Welcome to the farm!",
      }),
    }),
    { targetLanguage: "de" },
  );

  assert.equal(project.game, "stardew");
  assert.equal(project.targetLocale, "de");
  project.entries[0].translation = "Willkommen auf dem Bauernhof!";
  project.entries[0].status = "edited";
  const { archive, filename } = await buildResourcePack(project, undefined, "nodebuffer");
  const zip = await JSZip.loadAsync(archive, { checkCRC32: true });
  assert.deepEqual(
    JSON.parse(await zip.file("ExampleStardew/i18n/de.json").async("string")),
    { greeting: "Willkommen auf dem Bauernhof!" },
  );
  assert.ok(zip.file("ExampleStardew/manifest.json"));
  assert.ok(zip.file("ExampleStardew/i18n/default.json"));
  const rebuilt = await analyzeArchive(new File([archive], filename));
  assert.equal(rebuilt.game, "stardew");
  assert.equal(rebuilt.mod.id, "Example.Author.Mod");
});

test("RimWorld language XML is exported as a standalone translation mod", async () => {
  const project = await analyzeArchive(
    await makeArchiveFile("ExampleRimWorld.zip", {
      "ExampleRimWorld/About/About.xml":
        "<ModMetaData><name>Example RimWorld Mod</name><packageId>example.rimworld</packageId></ModMetaData>",
      "ExampleRimWorld/Languages/English/Keyed/UI.xml":
        "<LanguageData><Example.Button>Start game</Example.Button></LanguageData>",
      "ExampleRimWorld/Languages/English/DefInjected/ThingDef/Items.xml":
        "<LanguageData><ExampleItem.label>example item</ExampleItem.label></LanguageData>",
    }),
  );

  assert.equal(project.game, "rimworld");
  assert.equal(project.targetLocale, "Japanese");
  assert.equal(project.entries.length, 2);
  for (const entry of project.entries) {
    entry.translation = `訳:${entry.source}`;
    entry.status = "edited";
  }
  const { archive, filename } = await buildResourcePack(project, undefined, "nodebuffer");
  const zip = await JSZip.loadAsync(archive, { checkCRC32: true });
  const root = "Example_RimWorld_Mod_Japanese_Translation";
  assert.ok(
    zip.file(`${root}/Languages/Japanese/Keyed/UI.xml`),
  );
  assert.match(
    await zip
      .file(`${root}/Languages/Japanese/DefInjected/ThingDef/Items.xml`)
      .async("string"),
    /<ExampleItem\.label>訳:example item<\/ExampleItem\.label>/,
  );
  const about = await zip.file(`${root}/About/About.xml`).async("string");
  assert.match(about, /<packageId>example\.rimworld\.babelbreaker\.japanese<\/packageId>/);
  assert.match(about, /<loadAfter>[\s\S]*<li>example\.rimworld<\/li>/);
  assert.equal(zip.file("ExampleRimWorld/About/About.xml"), null);
  const rebuilt = await analyzeArchive(new File([archive], filename));
  assert.equal(rebuilt.game, "rimworld");
  assert.equal(rebuilt.mod.id, "example.rimworld.babelbreaker.japanese");
});

test("each supported game uses its native target locale name", () => {
  assert.equal(getGameTargetLocale("minecraft", "ja"), "ja_jp");
  assert.equal(getGameTargetLocale("factorio", "en"), "en");
  assert.equal(getGameTargetLocale("stardew", "en"), "default");
  assert.equal(getGameTargetLocale("rimworld", "en"), "English");
  assert.equal(getGameTargetLocale("factorio", "zh-Hans"), "zh-CN");
  assert.equal(getGameTargetLocale("stardew", "pt"), "pt");
  assert.equal(getGameTargetLocale("rimworld", "ja"), "Japanese");
});

test("multiple non-Minecraft mods export as one bundle of installable archives", async () => {
  const first = await analyzeArchive(
    await makeArchiveFile("mod-one_1.0.0.zip", {
      "mod-one_1.0.0/info.json": JSON.stringify({
        name: "mod-one",
        title: "Mod One",
        version: "1.0.0",
      }),
      "mod-one_1.0.0/locale/en/base.cfg":
        "[item-name]\nshared=First item\n",
    }),
  );
  const second = await analyzeArchive(
    await makeArchiveFile("mod-two_1.0.0.zip", {
      "mod-two_1.0.0/info.json": JSON.stringify({
        name: "mod-two",
        title: "Mod Two",
        version: "1.0.0",
      }),
      "mod-two_1.0.0/locale/en/base.cfg":
        "[item-name]\nshared=Second item\n",
    }),
  );
  const project = combineProjects([first, second]);
  assert.equal(project.entries.length, 2);
  project.entries.forEach((entry) => {
    entry.translation = `訳:${entry.source}`;
    entry.status = "edited";
  });

  const { archive, filename } = await buildResourcePack(
    project,
    undefined,
    "nodebuffer",
  );
  assert.equal(filename, "2-mods_factorio_ja.zip");
  const bundle = await JSZip.loadAsync(archive);
  for (const [modId, expected] of [
    ["mod-one", "訳:First item"],
    ["mod-two", "訳:Second item"],
  ]) {
    const child = await JSZip.loadAsync(
      await bundle.file(`${modId}_1.0.0.zip`).async("uint8array"),
    );
    assert.ok(child.file(`${modId}_1.0.0/info.json`));
    assert.match(
      await child
        .file(`${modId}_1.0.0/locale/ja/base.cfg`)
        .async("string"),
      new RegExp(`shared=${expected}`),
    );
  }
});

test("multiple MOD projects combine into one installable resource pack", async () => {
  const first = await analyzeArchive(
    await makeModFile({
      name: "first-mod-1.0.0.jar",
      fabric: {
        schemaVersion: 1,
        id: "first",
        name: "First Mod",
        version: "1.0.0",
        depends: { minecraft: ">=1.21.1" },
      },
      files: {
        "assets/first/lang/en_us.json": JSON.stringify({
          "item.first": "First Item",
        }),
      },
    }),
  );
  const second = await analyzeArchive(
    await makeModFile({
      name: "second-mod-1.0.0.jar",
      fabric: {
        schemaVersion: 1,
        id: "second",
        name: "Second Mod",
        version: "1.0.0",
        depends: { minecraft: ">=1.21.1" },
      },
      files: {
        "assets/second/lang/de_de.json": JSON.stringify({
          "item.second": "Zweiter Gegenstand",
        }),
      },
    }),
  );
  const project = combineProjects([first, second]);

  assert.equal(project.isBatch, true);
  assert.equal(project.mods.length, 2);
  assert.equal(project.entries.length, 2);
  assert.deepEqual(new Set(project.sourceLanguages), new Set(["en", "de"]));
  project.entries[0].translation = "最初のアイテム";
  project.entries[0].status = "translated";
  project.entries[1].translation = "2番目のアイテム";
  project.entries[1].status = "translated";

  const { archive, filename } = await buildResourcePack(
    project,
    "1.21",
    "nodebuffer",
  );
  assert.match(filename, /2_MODs_batch_ja_jp\.zip$/);
  const zip = await JSZip.loadAsync(archive);
  assert.ok(zip.file("assets/first/lang/ja_jp.json"));
  assert.ok(zip.file("assets/second/lang/ja_jp.json"));
  assert.match(await zip.file("_babel_breaker.txt").async("string"), /first@1\.0\.0/);
});

test("machine translations are counted as needing review until edited", async () => {
  const project = await analyzeArchive(await makeModFile());
  await translateProject(project, {
    translator: {
      async translate(text) {
        return text.replace("Example Item", "サンプルアイテム").replace("Energy", "エネルギー");
      },
    },
  });
  assert.equal(getProjectStats(project).needsReview, 2);
  project.entries[0].status = "edited";
  assert.equal(getProjectStats(project).needsReview, 1);
});

test("needs-review totals include every untranslated entry and exclude blank sources", async () => {
  const entries = Array.from({ length: 47 }, (_, index) => ({
    id: String(index),
    source: `Source ${index}`,
    translation: "",
    status: "pending",
    warning: "",
  }));
  entries.push({
    id: "blank",
    source: "   ",
    translation: "",
    status: "excluded",
    warning: "",
  });
  const stats = getProjectStats({ entries, namespaces: [] });

  assert.equal(stats.pending, 47);
  assert.equal(stats.needsReview, 47);
  assert.equal(stats.excluded, 1);
});

test("project stats support temporary translation batches without namespaces", () => {
  const stats = getProjectStats({
    entries: [{
      id: "ocr-region-1",
      source: "Play",
      translation: "プレイ",
      status: "translated",
      warning: "",
    }],
  });

  assert.equal(stats.total, 1);
  assert.equal(stats.namespaces, 0);
});

test("blank source values are marked as not translatable", async () => {
  const project = await analyzeArchive(
    await makeModFile({
      files: {
        "assets/example/lang/en_us.json": JSON.stringify({
          blank: "",
          pending: "Translate me",
        }),
      },
    }),
  );

  assert.equal(project.entries[0].status, "excluded");
  assert.equal(getProjectStats(project).pending, 1);
  assert.equal(getProjectStats(project).excluded, 1);
});

test("JAR analysis rejects traversal entries", async () => {
  const file = await makeModFile({
    files: {
      "assets/example/lang/en_us.json": JSON.stringify({ "item.example": "Example" }),
      "../outside.txt": "unsafe",
    },
  });
  await assert.rejects(analyzeArchive(file), /安全でないファイルパス/);
});

test("JAR analysis skips invalid Minecraft namespaces", async () => {
  const file = await makeModFile({
    files: {
      "assets/example/lang/en_us.json": JSON.stringify({ "item.example": "Example" }),
      "assets/INVALID SPACE/lang/en_us.json": JSON.stringify({ bad: "Unsafe" }),
    },
  });
  const project = await analyzeArchive(file);
  assert.deepEqual(project.namespaces.map((item) => item.namespace), ["example"]);
  assert.equal(project.warnings.length, 1);
  assert.match(project.warnings[0], /namespace/);
});

test("special object keys cannot mutate parser prototypes", async () => {
  const legacy = parseLegacyLang("__proto__=safe\nconstructor=also-safe\n");
  assert.equal(Object.getPrototypeOf(legacy), Object.prototype);
  assert.equal(Object.hasOwn(legacy, "__proto__"), true);
  assert.equal(legacy.__proto__, "safe");

  const project = await analyzeArchive(
    await makeModFile({
      files: {
        "assets/example/lang/en_us.json": JSON.stringify({
          __proto__: "ignored-by-object-literal",
          constructor: "Constructor",
          prototype: "Prototype",
        }),
      },
    }),
  );
  const result = applyClipboardTranslation(
    project,
    JSON.stringify({
      constructor: "コンストラクター",
      prototype: "プロトタイプ",
    }),
  );
  assert.equal(result.applied, 2);
  assert.equal(Object.getPrototypeOf({}), Object.prototype);
});

test("clipboard payload round-trips without changing keys", async () => {
  const project = await analyzeArchive(
    await makeModFile({
      files: {
        "assets/example/lang/en_us.json": JSON.stringify({
          "item.example": "Example Item",
          "gui.energy": "Energy: %s / %s",
        }),
      },
    }),
  );
  assert.match(buildClipboardPayload(project), /"item\.example"/);

  const result = applyClipboardTranslation(
    project,
    JSON.stringify({
      "item.example": "サンプルアイテム",
      "gui.energy": "エネルギー: %s / %s",
    }),
  );
  assert.deepEqual(result, { applied: 2, rejected: 0, remaining: 0 });
});

test("external translation request describes each detected source language", async () => {
  const project = await analyzeArchive(
    await makeModFile({
      files: {
        "assets/example/lang/fr_fr.json": JSON.stringify({
          "item.example": "Objet magique",
        }),
      },
    }),
    { targetLanguage: "ko" },
  );
  const request = buildTranslationRequest(project);
  assert.match(request, /example: French \(Français\) \[fr_fr\]/);
  assert.match(request, /into Korean \(한국어\)/);
  assert.doesNotMatch(request, /from English/);
});

test("clipboard import rejects broken placeholders", async () => {
  const project = await analyzeArchive(await makeModFile());
  const result = applyClipboardTranslation(
    project,
    JSON.stringify({
      "item.example": "サンプルアイテム",
      "gui.energy": "エネルギー",
    }),
  );
  assert.equal(result.applied, 1);
  assert.equal(result.rejected, 1);
  assert.equal(getProjectStats(project).warnings, 1);
});

test("local translation reuses identical text and preserves placeholders", async () => {
  const project = await analyzeArchive(
    await makeModFile({
      files: {
        "assets/example/lang/en_us.json": JSON.stringify({
          first: "Energy: %s",
          second: "Energy: %s",
        }),
      },
    }),
  );
  let calls = 0;
  const translator = {
    async translate(text) {
      calls += 1;
      return text.replace("Energy", "エネルギー");
    },
  };
  await translateProject(project, { translator });
  assert.equal(project.entries[0].translation, "エネルギー: %s");
  assert.equal(project.entries[1].translation, "エネルギー: %s");
  assert.equal(calls, 1);
});

test("local translation selects a translator for each detected source language", async () => {
  const project = await analyzeArchive(
    await makeModFile({
      files: {
        "assets/example/lang/de_de.json": JSON.stringify({
          first: "Energie: %s",
        }),
        "assets/addon/lang/es_es.json": JSON.stringify({
          second: "Energía",
        }),
      },
    }),
  );
  const created = [];
  const destroyed = [];
  await translateProject(project, {
    translatorFactory: async ({ sourceLanguage, targetLanguage }) => {
      created.push(`${sourceLanguage}-${targetLanguage}`);
      return {
        async translate(text) {
          if (targetLanguage === "en") {
            return text.replace(/Energie|Energía/, "Energy");
          }
          return text.replace("Energy", "エネルギー");
        },
        async destroy() {
          destroyed.push(sourceLanguage);
        },
      };
    },
  });

  assert.deepEqual(created, ["de-en", "en-ja", "es-en"]);
  assert.equal(project.entries[0].translation, "エネルギー: %s");
  assert.equal(project.entries[1].translation, "エネルギー");
  assert.deepEqual(new Set(destroyed), new Set(["de", "en", "es"]));
});

test("local translation uses the direct source-to-English model", async () => {
  const project = await analyzeArchive(
    await makeModFile({
      files: {
        "assets/example/lang/de_de.json": JSON.stringify({
          first: "Energie",
        }),
      },
    }),
    { targetLanguage: "en" },
  );
  const created = [];
  await translateProject(project, {
    translatorFactory: async ({ sourceLanguage, targetLanguage }) => {
      created.push(`${sourceLanguage}-${targetLanguage}`);
      return {
        async translate(text) {
          return text.replace("Energie", "Energy");
        },
        async destroy() {},
      };
    },
  });
  assert.deepEqual(created, ["de-en"]);
  assert.equal(project.entries[0].translation, "Energy");
});

test("local translation translates non-Latin source text", async () => {
  const project = await analyzeArchive(
    await makeModFile({
      files: {
        "assets/example/lang/ja_jp.json": JSON.stringify({
          item: "魔法のアイテム",
        }),
      },
    }),
    { targetLanguage: "de" },
  );
  let calls = 0;
  await translateProject(project, {
    translator: {
      async translate() {
        calls += 1;
        return "Magischer Gegenstand";
      },
    },
  });
  assert.equal(calls, 1);
  assert.equal(project.entries[0].translation, "Magischer Gegenstand");
});

test("Japanese content mislabeled as en_us is not translated as English", async () => {
  const reportedText =
    "指揮官さま、お買い物をしてくれないと、私の稼ぎがなくなりますわ！";
  const project = await analyzeArchive(
    await makeModFile({
      files: {
        "assets/example/lang/en_us.json": JSON.stringify({
          "hmggirlfront.kalina.serif_0.name": reportedText,
          message: "準備ができました",
        }),
      },
    }),
    { targetLanguage: "ja" },
  );

  assert.deepEqual(project.sourceLanguages, ["ja"]);
  assert.equal(project.namespaces[0].sourceLanguage, "ja");
  assert.equal(project.entries[0].sourceLanguage, "ja");
  assert.equal(project.entries[0].declaredSourceLanguage, "en");
  assert.equal(project.entries[0].detectedSourceLanguage, "ja");
  assert.equal(project.entries[0].languageConfidence, "high");
  assert.equal(project.entries[0].languageConflict, true);
  assert.equal(project.entries[0].translation, reportedText);
  assert.equal(project.entries[0].status, "preserved");

  let calls = 0;
  await translateProject(project, {
    translator: {
      async translate() {
        calls += 1;
        return "broken";
      },
    },
  });
  assert.equal(calls, 0);
});

test("translation rechecks a Japanese entry incorrectly marked as English", async () => {
  const source =
    "指揮官さま、お買い物をしてくれないと、私の稼ぎがなくなりますわ！";
  const project = {
    targetLanguage: "ja",
    namespaces: [],
    entries: [
      {
        source,
        sourceLanguage: "en",
        sourceLocale: "en_us",
        translation: "",
        status: "pending",
        warning: "",
      },
    ],
  };
  let calls = 0;

  const stats = await translateProject(project, {
    translator: {
      async translate() {
        calls += 1;
        return "茇リュ�テュさます、お、よ、よ、よ!";
      },
    },
  });

  assert.equal(calls, 0);
  assert.equal(project.entries[0].sourceLanguage, "ja");
  assert.equal(project.entries[0].declaredSourceLanguage, "en");
  assert.equal(project.entries[0].detectedSourceLanguage, "ja");
  assert.equal(project.entries[0].languageConflict, true);
  assert.equal(project.entries[0].translation, source);
  assert.equal(project.entries[0].status, "preserved");
  assert.equal(stats.pending, 0);
});

test("a manually confirmed source language overrides automatic script detection", async () => {
  const source = "指揮官さま、お買い物をしてくれないと、私の稼ぎがなくなりますわ！";
  const project = {
    targetLanguage: "ja",
    namespaces: [],
    entries: [
      {
        source,
        sourceLanguage: "en",
        declaredSourceLanguage: "en",
        detectedSourceLanguage: "ja",
        languageConfirmed: true,
        translationBlocked: false,
        sourceLocale: "en_us",
        translation: "",
        status: "pending",
        warning: "",
      },
    ],
  };
  let calls = 0;

  await translateProject(project, {
    translator: {
      async translate() {
        calls += 1;
        return "手動指定に基づく翻訳";
      },
    },
  });

  assert.equal(calls, 1);
  assert.equal(project.entries[0].sourceLanguage, "en");
  assert.equal(project.entries[0].languageConfidence, "manual");
  assert.equal(project.entries[0].translation, "手動指定に基づく翻訳");
  assert.equal(project.entries[0].status, "translated");
});

test("translation rejects replacement characters instead of accepting mojibake", async () => {
  const project = {
    targetLanguage: "ja",
    namespaces: [],
    entries: [
      {
        source: "Commander",
        sourceLanguage: "en",
        sourceLocale: "en_us",
        translation: "",
        status: "pending",
        warning: "",
      },
    ],
  };

  await translateProject(project, {
    translator: {
      async translate() {
        return "茇リュ�";
      },
    },
  });

  assert.equal(project.entries[0].translation, "");
  assert.match(project.entries[0].warning, /不正な文字/);
});

test("mixed English and Japanese content is detected per entry", async () => {
  const project = await analyzeArchive(
    await makeModFile({
      files: {
        "assets/example/lang/en_us.json": JSON.stringify({
          english: "Magic item",
          japanese: "魔法のアイテム",
          kanji: "設定",
        }),
      },
    }),
    { targetLanguage: "ja" },
  );

  assert.deepEqual(new Set(project.sourceLanguages), new Set(["en", "ja"]));
  assert.deepEqual(
    project.entries.map((entry) => entry.sourceLanguage),
    ["en", "ja", "en"],
  );
  assert.equal(project.entries[0].status, "pending");
  assert.equal(project.entries[1].status, "preserved");
  assert.equal(project.entries[2].status, "pending");
  assert.equal(project.entries[2].languageConfidence, "ambiguous");
  assert.equal(project.entries[2].translationBlocked, true);

  let calls = 0;
  await translateProject(project, {
    translator: {
      async translate(text) {
        calls += 1;
        return text === "Magic item" ? "魔法のアイテム" : "unexpected";
      },
    },
  });
  assert.equal(calls, 1);
  assert.equal(project.entries[2].translation, "");
});

test("unsupported source locales are kept for the external-tool fallback", async () => {
  const project = await analyzeArchive(
    await makeModFile({
      files: {
        "assets/example/lang/pl_pl.json": JSON.stringify({ item: "Przedmiot" }),
      },
    }),
  );
  assert.deepEqual(project.unsupportedSourceLocales, ["pl_pl"]);
  await assert.rejects(
    translateProject(project, {
      translatorFactory: async () => {
        throw new Error("should not initialize");
      },
    }),
    /未対応の原文言語.*pl_pl/,
  );
  assert.match(buildTranslationRequest(project), /locale pl_pl/);
});

test("built-in Japanese glossary is not applied to other target languages", () => {
  assert.equal(parseGlossary("", "ja").get("Mana"), "マナ");
  assert.equal(parseGlossary("", "de").has("Mana"), false);
  assert.equal(parseGlossary("Mana=Magie", "de").get("Mana"), "Magie");
});

test("pack metadata supports both classic and 1.21.9+ formats", () => {
  const project = createDemoProject();
  assert.equal(buildPackMetadata(project, "1.21").pack.pack_format, 34);
  assert.deepEqual(buildPackMetadata(project, "1.21.9").pack.min_format, [69, 0]);
  assert.equal(buildPackMetadata(project, "1.21.9").pack.max_format, 69);
  assert.equal("pack_format" in buildPackMetadata(project, "1.21.9").pack, false);
});

test("generated resource pack is installable and contains Japanese lang", async () => {
  const project = createDemoProject();
  const { archive, filename } = await buildResourcePack(project, "1.21", "nodebuffer");
  assert.match(filename, /ja_jp\.zip$/);
  const zip = await JSZip.loadAsync(archive);
  assert.ok(zip.file("pack.mcmeta"));
  assert.ok(zip.file("assets/babel_breaker/lang/ja_jp.json"));
  const lang = JSON.parse(await zip.file("assets/babel_breaker/lang/ja_jp.json").async("string"));
  assert.equal(lang["item.babel_breaker.mana_crystal"], "マナクリスタル");
});

test("resource pack omits untranslated, ignored, and unsafe entries", async () => {
  const project = createDemoProject();
  project.entries[0].translation = "";
  project.entries[0].status = "pending";
  project.entries[1].ignored = true;
  project.entries[2].warning = "unsafe";

  const stats = getProjectStats(project);
  assert.equal(stats.output, 1);
  assert.equal(stats.omitted, 3);

  const { archive } = await buildResourcePack(project, "1.21", "nodebuffer");
  const zip = await JSZip.loadAsync(archive);
  const lang = JSON.parse(
    await zip.file("assets/babel_breaker/lang/ja_jp.json").async("string"),
  );
  assert.deepEqual(Object.keys(lang), ["message.babel_breaker.welcome"]);
  assert.match(
    await zip.file("_babel_breaker.txt").async("string"),
    /omitted_entries=3/,
  );
});

test("1.12 resource packs use legacy .lang output", async () => {
  const project = createDemoProject();
  const { archive } = await buildResourcePack(project, "1.11", "nodebuffer");
  const zip = await JSZip.loadAsync(archive);
  assert.ok(zip.file("assets/babel_breaker/lang/ja_jp.lang"));
  assert.equal(zip.file("assets/babel_breaker/lang/ja_jp.json"), null);
});

test("resource pack path and filename use the selected language", async () => {
  const project = createDemoProject({ targetLanguage: "de" });
  const { archive, filename } = await buildResourcePack(project, "1.21", "nodebuffer");
  assert.match(filename, /de_de\.zip$/);
  const zip = await JSZip.loadAsync(archive);
  assert.ok(zip.file("assets/babel_breaker/lang/de_de.json"));
  assert.equal(zip.file("assets/babel_breaker/lang/ja_jp.json"), null);
  assert.match(
    JSON.parse(await zip.file("pack.mcmeta").async("string")).pack.description,
    /Deutsch$/,
  );
});
