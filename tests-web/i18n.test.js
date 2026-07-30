import assert from "node:assert/strict";
import test from "node:test";

import { createI18n, detectUiLocale } from "../src/i18n.js";
import {
  TARGET_LANGUAGES,
  detectTargetLanguage,
  estimateLocalModelSizeMb,
  getDefaultTargetLanguage,
  languageFromMinecraftLocale,
  getTargetLanguage,
} from "../src/languages.js";

test("tool interface supports five display languages", () => {
  assert.equal(createI18n("ja").t("guideLink"), "使い方");
  assert.equal(createI18n("en").t("guideLink"), "How to use");
  assert.equal(createI18n("ko").t("guideLink"), "사용 방법");
  assert.equal(createI18n("zh-Hans").t("guideLink"), "使用方法");
  assert.equal(createI18n("es").t("guideLink"), "Cómo usar");
});

test("language interpolation and browser locale detection work", () => {
  assert.equal(
    createI18n("en").t("workspaceTitle", { target: "Deutsch" }),
    "Translate this file to Deutsch",
  );
  assert.equal(detectUiLocale("ko-KR"), "ko");
  assert.equal(detectUiLocale("fr-FR"), "en");
  assert.equal(detectTargetLanguage("zh-TW"), "zh-Hant");
  assert.equal(detectTargetLanguage("pt-BR"), "pt");
});

test("default translation target follows the interface language", () => {
  assert.equal(getDefaultTargetLanguage("ja", ["en-US"]), "ja");
  assert.equal(getDefaultTargetLanguage("ko", ["en-US"]), "ko");
  assert.equal(getDefaultTargetLanguage("zh-Hans", ["en-US"]), "zh-Hans");
  assert.equal(getDefaultTargetLanguage("es", ["en-US"]), "es");
  assert.equal(getDefaultTargetLanguage("en", ["en-US", "de-DE"]), "de");
  assert.equal(getDefaultTargetLanguage("en", ["en-US"]), "ja");
});

test("all translation targets have a Minecraft locale", () => {
  assert.equal(TARGET_LANGUAGES.length, 10);
  assert.equal(getTargetLanguage("ko").minecraftLocale, "ko_kr");
  assert.equal(getTargetLanguage("missing").minecraftLocale, "ja_jp");
  assert.equal(
    new Set(TARGET_LANGUAGES.map((language) => language.minecraftLocale)).size,
    TARGET_LANGUAGES.length,
  );
});

test("Minecraft locale names identify supported source languages", () => {
  assert.equal(languageFromMinecraftLocale("en_us"), "en");
  assert.equal(languageFromMinecraftLocale("fr_fr"), "fr");
  assert.equal(languageFromMinecraftLocale("zh_cn"), "zh-Hans");
  assert.equal(languageFromMinecraftLocale("zh_tw"), "zh-Hant");
  assert.equal(languageFromMinecraftLocale("pl_pl"), null);
});

test("local model estimate includes one target model and each source model", () => {
  const project = {
    targetLanguage: "ja",
    entries: [
      { sourceLanguage: "en", translation: "" },
      { sourceLanguage: "de", translation: "" },
      { sourceLanguage: "es", translation: "" },
      { sourceLanguage: "fr", translation: "既存訳" },
    ],
  };
  assert.equal(estimateLocalModelSizeMb(project), 120);
});
