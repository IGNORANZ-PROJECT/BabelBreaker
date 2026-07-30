import assert from "node:assert/strict";
import { File } from "node:buffer";
import test from "node:test";
import JSZip from "jszip";

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
  assert.deepEqual(extractPlaceholderTokens("Energy: %1$s / %s §a{0}\n"), [
    "\n",
    "%1$s",
    "%s",
    "{0}",
    "§a",
  ]);
  assert.equal(placeholdersMatch("Hello %s", "こんにちは %s"), true);
  assert.equal(placeholdersMatch("Hello %s", "こんにちは"), false);
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

test("Factorio locale CFG is auto-detected and exported as a merge-ready ZIP", async () => {
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

  const { archive } = await buildResourcePack(project, undefined, "nodebuffer");
  const zip = await JSZip.loadAsync(archive);
  const output = await zip
    .file("example-factorio_1.0.0/locale/ja/base.cfg")
    .async("string");
  assert.match(output, /\[item-name\]\nexample-item=訳:Example item/);
  assert.ok(zip.file("_BABEL_BREAKER_README.txt"));
});

test("Stardew Valley Content Patcher i18n JSON is auto-detected", async () => {
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
  const { archive } = await buildResourcePack(project, undefined, "nodebuffer");
  const zip = await JSZip.loadAsync(archive);
  assert.deepEqual(
    JSON.parse(await zip.file("ExampleStardew/i18n/de.json").async("string")),
    { greeting: "Willkommen auf dem Bauernhof!" },
  );
});

test("RimWorld Keyed and DefInjected XML are auto-detected", async () => {
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
  const { archive } = await buildResourcePack(project, undefined, "nodebuffer");
  const zip = await JSZip.loadAsync(archive);
  assert.ok(
    zip.file("ExampleRimWorld/Languages/Japanese/Keyed/UI.xml"),
  );
  assert.match(
    await zip
      .file("ExampleRimWorld/Languages/Japanese/DefInjected/ThingDef/Items.xml")
      .async("string"),
    /<ExampleItem\.label>訳:example item<\/ExampleItem\.label>/,
  );
});

test("each supported game uses its native target locale name", () => {
  assert.equal(getGameTargetLocale("minecraft", "ja"), "ja_jp");
  assert.equal(getGameTargetLocale("factorio", "zh-Hans"), "zh-CN");
  assert.equal(getGameTargetLocale("stardew", "pt"), "pt");
  assert.equal(getGameTargetLocale("rimworld", "ja"), "Japanese");
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
