import JSZip from "jszip";
import { assertNativeOutputLayout } from "./output-validation.js";
import {
  createLocalTranslator,
  getLocalTranslatorStatus,
} from "./local-translator.js";
import {
  DEFAULT_TARGET_LANGUAGE,
  getSourceLanguage,
  getTargetLanguage,
  languageFromMinecraftLocale,
} from "./languages.js";
import {
  extractMinecraftContentDocuments,
  renderMinecraftContentDocument,
} from "./minecraft-content.js";
import {
  ARTIFACT_TYPES,
  analyzeArtifactDocuments,
  buildArtifactArchive,
  detectArtifactType,
} from "./artifact-formats.js";
import {
  extractJavaWorldRegionDocuments,
  renderJavaWorldRegionDocument,
} from "./java-world.js";

export const APP_NAME = "Babel Breaker";
export const TARGET_LOCALE = getTargetLanguage(DEFAULT_TARGET_LANGUAGE).minecraftLocale;
export const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;
export const MAX_ARCHIVE_ENTRIES = 100_000;
export const MAX_LANG_TEXT_LENGTH = 10 * 1024 * 1024;
export const MAX_TOTAL_LANG_BYTES = 64 * 1024 * 1024;
export const MAX_METADATA_TEXT_LENGTH = 2 * 1024 * 1024;
export const MAX_BATCH_FILES = 50;
export const MAX_BATCH_BYTES = 1024 * 1024 * 1024;

export const SUPPORTED_GAMES = {
  minecraft: {
    id: "minecraft",
    name: "Minecraft",
    format: "Java Edition lang JSON / LANG",
  },
  factorio: {
    id: "factorio",
    name: "Factorio",
    format: "locale CFG",
  },
  stardew: {
    id: "stardew",
    name: "Stardew Valley",
    format: "Content Patcher i18n JSON",
  },
  rimworld: {
    id: "rimworld",
    name: "RimWorld",
    format: "Languages XML",
  },
};

export const SUPPORTED_ARTIFACTS = ARTIFACT_TYPES;

const GAME_TARGET_LOCALES = {
  factorio: {
    en: "en", ja: "ja", ko: "ko", "zh-Hans": "zh-CN", "zh-Hant": "zh-TW",
    de: "de", es: "es-ES", fr: "fr", pt: "pt-BR", ru: "ru", it: "it",
  },
  stardew: {
    en: "default", ja: "ja", ko: "ko", "zh-Hans": "zh", "zh-Hant": "zh-TW",
    de: "de", es: "es", fr: "fr", pt: "pt", ru: "ru", it: "it",
  },
  rimworld: {
    en: "English", ja: "Japanese", ko: "Korean", "zh-Hans": "ChineseSimplified",
    "zh-Hant": "ChineseTraditional", de: "German", es: "Spanish",
    fr: "French", pt: "PortugueseBrazilian", ru: "Russian", it: "Italian",
  },
};

export function getGameTargetLocale(game, languageId) {
  const language = getTargetLanguage(languageId);
  return GAME_TARGET_LOCALES[game]?.[language.id] || language.minecraftLocale;
}

export const MINECRAFT_VERSIONS = [
  { id: "26.1", label: "26.1", min: [84, 0], max: 84, legacyLang: false },
  { id: "1.21.11", label: "1.21.11", min: [75, 0], max: 75, legacyLang: false },
  { id: "1.21.9", label: "1.21.9 – 1.21.10", min: [69, 0], max: 69, legacyLang: false },
  { id: "1.21.7", label: "1.21.7 – 1.21.8", format: 64, legacyLang: false },
  { id: "1.21.6", label: "1.21.6", format: 63, legacyLang: false },
  { id: "1.21.5", label: "1.21.5", format: 55, legacyLang: false },
  { id: "1.21.4", label: "1.21.4", format: 46, legacyLang: false },
  { id: "1.21", label: "1.21 – 1.21.3", format: 34, legacyLang: false },
  { id: "1.20.5", label: "1.20.5 – 1.20.6", format: 32, legacyLang: false },
  { id: "1.20.3", label: "1.20.3 – 1.20.4", format: 22, legacyLang: false },
  { id: "1.20.2", label: "1.20.2", format: 18, legacyLang: false },
  { id: "1.20", label: "1.20 – 1.20.1", format: 15, legacyLang: false },
  { id: "1.19.4", label: "1.19.4", format: 13, legacyLang: false },
  { id: "1.19.3", label: "1.19.3", format: 12, legacyLang: false },
  { id: "1.19", label: "1.19 – 1.19.2", format: 9, legacyLang: false },
  { id: "1.18", label: "1.18 – 1.18.2", format: 8, legacyLang: false },
  { id: "1.17", label: "1.17 – 1.17.1", format: 7, legacyLang: false },
  { id: "1.16.2", label: "1.16.2 – 1.16.5", format: 6, legacyLang: false },
  { id: "1.15", label: "1.15 – 1.16.1", format: 5, legacyLang: false },
  { id: "1.13", label: "1.13 – 1.14.4", format: 4, legacyLang: false },
  { id: "1.11", label: "1.11 – 1.12.2", format: 3, legacyLang: true },
];

const SOURCE_LOCALE_PRIORITY = ["en_us", "en_gb"];
const VALID_NAMESPACE_PATTERN = /^[a-z0-9_.-]+$/;
const TOKEN_PATTERN =
  /\$\([^)]*\)|%%\d+|<\/?[A-Za-z][^>\r\n]*>|%[A-Za-z0-9_.:-]+%|%(?:\d+\$)?[-#+ 0,(<]*\d*(?:\.\d+)?[tT]?[a-zA-Z%]|\{[A-Za-z0-9_.:-]+(?:,[^{}\r\n]+)?\}|[§&][0-9a-fk-or]|\\[ntr]|[\n\t\r]|https?:\/\/[^\s]+/gi;
const TRANSLATABLE_TEXT_PATTERN = /\p{L}/u;
const LETTER_PATTERN = /\p{L}/gu;
const JAPANESE_KANA_PATTERN = /[\p{Script=Hiragana}\p{Script=Katakana}]/gu;
const HAN_PATTERN = /\p{Script=Han}/gu;
const HANGUL_PATTERN = /\p{Script=Hangul}/gu;
const CYRILLIC_PATTERN = /\p{Script=Cyrillic}/gu;

export const DEFAULT_GLOSSARY = [
  ["Mana", "マナ"],
  ["Quest", "クエスト"],
  ["Biome", "バイオーム"],
  ["Redstone", "レッドストーン"],
  ["Craft", "クラフト"],
];

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function countMatches(text, pattern) {
  return String(text).match(pattern)?.length || 0;
}

function detectScriptEvidence(text) {
  const value = String(text || "");
  const letters = countMatches(value, LETTER_PATTERN);
  if (!letters) {
    return { language: null, confidence: "none", script: "none" };
  }

  const kana = countMatches(value, JAPANESE_KANA_PATTERN);
  const han = countMatches(value, HAN_PATTERN);
  if (kana > 0 && (kana + han) / letters >= 0.3) {
    return { language: "ja", confidence: "high", script: "japanese" };
  }

  const hangul = countMatches(value, HANGUL_PATTERN);
  if (hangul > 0 && hangul / letters >= 0.3) {
    return { language: "ko", confidence: "high", script: "hangul" };
  }

  const cyrillic = countMatches(value, CYRILLIC_PATTERN);
  if (cyrillic > 0 && cyrillic / letters >= 0.5) {
    return { language: null, confidence: "ambiguous", script: "cyrillic" };
  }

  if (han > 0 && han / letters >= 0.5) {
    return { language: null, confidence: "ambiguous", script: "han" };
  }

  return { language: null, confidence: "none", script: "other" };
}

function classifyEntryLanguage(text, declaredSourceLanguage = null) {
  const evidence = detectScriptEvidence(text);
  const declaredIsCjk = ["ja", "zh-Hans", "zh-Hant"].includes(
    declaredSourceLanguage,
  );
  const ambiguousConflict =
    Boolean(declaredSourceLanguage) &&
    ((evidence.script === "han" && !declaredIsCjk) ||
      (evidence.script === "cyrillic" && declaredSourceLanguage !== "ru"));
  const detectedConflict =
    Boolean(evidence.language) &&
    Boolean(declaredSourceLanguage) &&
    evidence.language !== declaredSourceLanguage;

  return {
    declaredSourceLanguage,
    detectedSourceLanguage: evidence.language,
    sourceLanguage: evidence.language || declaredSourceLanguage,
    languageConfidence:
      evidence.confidence === "high"
        ? "high"
        : ambiguousConflict
          ? "ambiguous"
          : declaredSourceLanguage
            ? "declared"
            : "unknown",
    languageEvidence: evidence.script,
    languageConflict: detectedConflict || ambiguousConflict,
    languageConfirmed: false,
    translationBlocked: ambiguousConflict,
  };
}

function ensureEntryLanguageMetadata(entry) {
  const declaredSourceLanguage =
    entry.declaredSourceLanguage ??
    languageFromMinecraftLocale(entry.sourceLocale) ??
    entry.sourceLanguage ??
    null;
  const classified = classifyEntryLanguage(
    entry.source,
    declaredSourceLanguage,
  );
  const languageConfirmed = Boolean(entry.languageConfirmed);
  const manuallyConfirmedLanguage = languageConfirmed
    ? declaredSourceLanguage || entry.sourceLanguage || null
    : null;
  Object.assign(entry, classified, {
    ...(manuallyConfirmedLanguage
      ? {
          declaredSourceLanguage: manuallyConfirmedLanguage,
          sourceLanguage: manuallyConfirmedLanguage,
          languageConfidence: "manual",
        }
      : {}),
    languageConfirmed,
    translationBlocked:
      classified.translationBlocked &&
      !languageConfirmed &&
      !entry.translation.trim(),
  });
  return entry;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validateLangMap(value, label = "lang") {
  if (!isPlainObject(value)) {
    throw new Error(`${label} はJSONオブジェクトではありません。`);
  }
  const result = {};
  for (const [key, text] of Object.entries(value)) {
    if (typeof text !== "string") {
      throw new Error(`${label} の値はすべて文字列である必要があります: ${key}`);
    }
    defineOwnValue(result, String(key), text);
  }
  return result;
}

function defineOwnValue(target, key, value) {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
}

export function parseLegacyLang(text) {
  const result = {};
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.includes("=") ? line.indexOf("=") : line.indexOf(":");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    if (key) defineOwnValue(result, key, line.slice(separator + 1));
  }
  return result;
}

function stringifyLegacyLang(data) {
  return `${Object.entries(data)
    .map(([key, value]) => `${key}=${String(value).replace(/\r?\n/g, "\\n")}`)
    .join("\n")}\n`;
}

export function extractPlaceholderTokens(text) {
  return [...String(text).matchAll(TOKEN_PATTERN)].map((match) => match[0]).sort();
}

export function placeholdersMatch(source, translated) {
  const left = extractPlaceholderTokens(source);
  const right = extractPlaceholderTokens(translated);
  return left.length === right.length && left.every((token, index) => token === right[index]);
}

function shouldTranslate(source, target) {
  if (typeof target !== "string" || !target.trim()) return true;
  if (!placeholdersMatch(source, target)) return true;
  return normalizeText(source) === normalizeText(target);
}

function assertSafeArchivePath(entry) {
  const original = entry.unsafeOriginalName || entry.name;
  const normalized = String(original).replaceAll("\\", "/");
  if (
    normalized.startsWith("/") ||
    /^[a-zA-Z]:\//.test(normalized) ||
    normalized.split("/").some((part) => part === "..")
  ) {
    throw new Error(`安全でないファイルパスを検出しました: ${original}`);
  }
}

function getDeclaredUncompressedSize(entry) {
  const size = Number(entry?._data?.uncompressedSize);
  return Number.isFinite(size) && size >= 0 ? size : null;
}

async function readEntryText(entry, label, maxLength = MAX_LANG_TEXT_LENGTH) {
  const declaredSize = getDeclaredUncompressedSize(entry);
  if (declaredSize !== null && declaredSize > maxLength) {
    throw new Error(`${label} の展開後サイズが大きすぎます。`);
  }
  const text = await entry.async("string");
  if (text.length > maxLength) {
    throw new Error(`${label} が大きすぎます。`);
  }
  return text.replace(/^\uFEFF/, "");
}

async function readEntryBytes(entry, label, maxLength = MAX_LANG_TEXT_LENGTH) {
  const declaredSize = getDeclaredUncompressedSize(entry);
  if (declaredSize !== null && declaredSize > maxLength) {
    throw new Error(`${label} の展開後サイズが大きすぎます。`);
  }
  const bytes = await entry.async("uint8array");
  if (bytes.byteLength > maxLength) {
    throw new Error(`${label} が大きすぎます。`);
  }
  return bytes;
}

function findEntry(entries, wantedPath) {
  const wanted = wantedPath.toLowerCase();
  return entries.find((entry) => entry.name.toLowerCase() === wanted);
}

function cleanMetadataValue(value, fallback, maxLength = 160) {
  const text = String(value ?? "")
    .replace(/[\u0000-\u001F\u007F]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
  if (!text || /^\$\{.+}$/.test(text)) return fallback;
  return text;
}

function versionFromFilename(fileName) {
  const matches = String(fileName).match(/(?:^|[-_ ])((?:1\.\d+|2\d)\.\d+(?:\.\d+)?)(?=$|[-_ ])/g) || [];
  const values = matches.map((value) => value.replace(/^[-_ ]/, ""));
  return values.find((value) => value.startsWith("1.") || value.startsWith("2")) || "";
}

function friendlyNameFromFilename(fileName) {
  return String(fileName)
    .replace(/\.(?:jar|zip)$/i, "")
    .replace(/[-_ ]?(?:1\.\d+|2\d)\.\d+(?:\.\d+)?/g, "")
    .replace(/[-_]+/g, " ")
    .trim();
}

function parseTomlString(text, key) {
  const match = String(text).match(new RegExp(`^\\s*${key}\\s*=\\s*["']([^"']+)["']`, "mi"));
  return match?.[1]?.trim() || "";
}

async function detectModMetadata(entries, fileName, namespaces) {
  const fallbackVersion = versionFromFilename(fileName) || "unknown";
  const fallbackName = friendlyNameFromFilename(fileName) || namespaces[0] || "Unknown MOD";

  const fabric = findEntry(entries, "fabric.mod.json");
  if (fabric) {
    try {
      const data = JSON.parse(
        await readEntryText(fabric, fabric.name, MAX_METADATA_TEXT_LENGTH),
      );
      const minecraft = data.depends?.minecraft;
      return {
        loader: "Fabric",
        id: cleanMetadataValue(data.id, namespaces[0] || "unknownmod"),
        name: cleanMetadataValue(data.name, fallbackName),
        version: cleanMetadataValue(data.version, fallbackVersion),
        minecraft: Array.isArray(minecraft) ? minecraft.join(" ") : String(minecraft || ""),
      };
    } catch {
      // Broken optional metadata should not hide usable lang files.
    }
  }

  const quilt = findEntry(entries, "quilt.mod.json");
  if (quilt) {
    try {
      const data = JSON.parse(
        await readEntryText(quilt, quilt.name, MAX_METADATA_TEXT_LENGTH),
      );
      const loader = data.quilt_loader || {};
      const minecraftDependency = Array.isArray(loader.depends)
        ? loader.depends.find((dependency) => dependency?.id === "minecraft")
        : null;
      return {
        loader: "Quilt",
        id: cleanMetadataValue(loader.id, namespaces[0] || "unknownmod"),
        name: cleanMetadataValue(loader.metadata?.name, fallbackName),
        version: cleanMetadataValue(loader.version, fallbackVersion),
        minecraft: Array.isArray(minecraftDependency?.versions)
          ? minecraftDependency.versions.join(" ")
          : String(minecraftDependency?.versions || ""),
      };
    } catch {
      // Fall through to Forge/fallback metadata.
    }
  }

  const modsToml =
    findEntry(entries, "meta-inf/mods.toml") || findEntry(entries, "meta-inf/neoforge.mods.toml");
  if (modsToml) {
    const text = await readEntryText(modsToml, modsToml.name, MAX_METADATA_TEXT_LENGTH);
    const manifest = findEntry(entries, "meta-inf/manifest.mf");
    const manifestText = manifest
      ? await readEntryText(manifest, manifest.name, MAX_METADATA_TEXT_LENGTH)
      : "";
    const manifestVersion =
      manifestText.match(/^(?:Implementation-Version|Specification-Version):\s*(.+)$/im)?.[1]?.trim() || "";
    const minecraftBlock = text.match(
      /\[\[dependencies\.[^\]]+\]\][\s\S]*?modId\s*=\s*["']minecraft["'][\s\S]*?(?=\[\[|$)/i,
    )?.[0];
    return {
      loader: modsToml.name.toLowerCase().includes("neoforge") ? "NeoForge" : "Forge",
      id: cleanMetadataValue(parseTomlString(text, "modId"), namespaces[0] || "unknownmod"),
      name: cleanMetadataValue(parseTomlString(text, "displayName"), fallbackName),
      version: cleanMetadataValue(parseTomlString(text, "version"), manifestVersion || fallbackVersion),
      minecraft: parseTomlString(minecraftBlock || "", "versionRange"),
    };
  }

  return {
    loader: "Minecraft",
    id: namespaces[0] || "unknownmod",
    name: fallbackName,
    version: fallbackVersion,
    minecraft: versionFromFilename(fileName),
  };
}

function chooseSource(sources, targetLocale = TARGET_LOCALE) {
  const sorted = [...sources].sort((left, right) => {
    const leftLocale = SOURCE_LOCALE_PRIORITY.indexOf(left.locale);
    const rightLocale = SOURCE_LOCALE_PRIORITY.indexOf(right.locale);
    const leftKnown = Boolean(languageFromMinecraftLocale(left.locale));
    const rightKnown = Boolean(languageFromMinecraftLocale(right.locale));
    const leftScore =
      leftLocale >= 0
        ? leftLocale
        : left.locale === targetLocale
          ? 999
          : leftKnown
            ? 100
            : 500;
    const rightScore =
      rightLocale >= 0
        ? rightLocale
        : right.locale === targetLocale
          ? 999
          : rightKnown
            ? 100
            : 500;
    if (leftScore !== rightScore) return leftScore - rightScore;
    if (left.ext !== right.ext) return left.ext === "json" ? -1 : 1;
    return left.path.localeCompare(right.path);
  });
  return sorted.find((source) => source.locale !== targetLocale) || sorted[0];
}

function languageFromGameLocale(locale) {
  const normalized = String(locale || "")
    .trim()
    .replaceAll("_", "-")
    .toLowerCase();
  if (!normalized || normalized === "default" || normalized === "english") return "en";
  if (
    normalized === "chinesesimplified" ||
    normalized.startsWith("zh-cn") ||
    normalized === "zh"
  ) return "zh-Hans";
  if (
    normalized === "chinesetraditional" ||
    normalized.startsWith("zh-tw") ||
    normalized.startsWith("zh-hk")
  ) return "zh-Hant";
  const rimWorldLocales = {
    japanese: "ja",
    korean: "ko",
    german: "de",
    spanish: "es",
    french: "fr",
    portuguesebrazilian: "pt",
    russian: "ru",
    italian: "it",
  };
  if (rimWorldLocales[normalized]) return rimWorldLocales[normalized];
  const prefix = normalized.split("-")[0];
  return ["en", "ja", "ko", "de", "es", "fr", "pt", "ru", "it"].includes(prefix)
    ? prefix
    : null;
}

function chooseGameSource(sources, targetLocale) {
  const priority = ["en", "en-us", "default", "english"];
  return [...sources].sort((left, right) => {
    const leftLocale = left.locale.toLowerCase();
    const rightLocale = right.locale.toLowerCase();
    const leftScore = priority.indexOf(leftLocale);
    const rightScore = priority.indexOf(rightLocale);
    const normalizedLeft = leftScore < 0 ? 100 : leftScore;
    const normalizedRight = rightScore < 0 ? 100 : rightScore;
    if (normalizedLeft !== normalizedRight) return normalizedLeft - normalizedRight;
    if (leftLocale === String(targetLocale).toLowerCase()) return 1;
    if (rightLocale === String(targetLocale).toLowerCase()) return -1;
    return left.path.localeCompare(right.path);
  })[0];
}

function parseFactorioLocale(text) {
  const data = {};
  let section = "";
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith(";") || line.startsWith("#")) continue;
    const sectionMatch = line.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      section = sectionMatch[1].trim();
      continue;
    }
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    if (key) defineOwnValue(data, `${section}\u0000${key}`, line.slice(separator + 1));
  }
  return data;
}

function stringifyFactorioLocale(data) {
  const sections = new Map();
  for (const [compoundKey, value] of Object.entries(data)) {
    const separator = compoundKey.indexOf("\u0000");
    const section = separator >= 0 ? compoundKey.slice(0, separator) : "";
    const key = separator >= 0 ? compoundKey.slice(separator + 1) : compoundKey;
    if (!sections.has(section)) sections.set(section, []);
    sections.get(section).push(`${key}=${String(value).replace(/\r?\n/g, "\\n")}`);
  }
  return `${[...sections]
    .flatMap(([section, lines]) => [
      ...(section ? [`[${section}]`] : []),
      ...lines,
      "",
    ])
    .join("\n")}`;
}

function decodeXmlText(text) {
  return String(text)
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

function escapeXmlText(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function parseRimWorldLanguageXml(text) {
  const data = {};
  const withoutComments = String(text).replace(/<!--[\s\S]*?-->/g, "");
  const leafPattern = /<([A-Za-z_][\w.-]*)\b[^>]*>([^<]*)<\/\1>/g;
  for (const match of withoutComments.matchAll(leafPattern)) {
    if (match[1] === "LanguageData") continue;
    defineOwnValue(data, match[1], decodeXmlText(match[2]));
  }
  return data;
}

function stringifyRimWorldLanguageXml(data) {
  const lines = Object.entries(data).map(
    ([key, value]) => `  <${key}>${escapeXmlText(value)}</${key}>`,
  );
  return `<?xml version="1.0" encoding="utf-8"?>\n<LanguageData>\n${lines.join("\n")}\n</LanguageData>\n`;
}

async function parseJsonMetadata(entry, fallback = {}) {
  if (!entry) return fallback;
  try {
    return JSON.parse(await readEntryText(entry, entry.name, MAX_METADATA_TEXT_LENGTH));
  } catch {
    return fallback;
  }
}

async function analyzeGameArchive(
  archiveEntries,
  file,
  game,
  targetLanguage,
  sourceBytes,
) {
  const language = getTargetLanguage(targetLanguage);
  const targetLocale = getGameTargetLocale(game, language.id);
  const warnings = [];
  const sources = [];
  let mod;

  if (game === "factorio") {
    const infoEntry = archiveEntries.find(
      (entry) => !entry.dir && /(^|\/)info\.json$/i.test(entry.name),
    );
    const info = await parseJsonMetadata(infoEntry);
    const root = infoEntry?.name.replace(/info\.json$/i, "") || "";
    mod = {
      loader: "Factorio",
      id: cleanMetadataValue(info.name, sanitizeFileName(file.name)),
      name: cleanMetadataValue(info.title || info.name, friendlyNameFromFilename(file.name)),
      version: cleanMetadataValue(info.version, versionFromFilename(file.name) || "unknown"),
      root,
    };
    for (const entry of archiveEntries.filter(
      (candidate) => !candidate.dir && /(^|\/)locale\/[^/]+\/[^/]+\.cfg$/i.test(candidate.name),
    )) {
      const match = entry.name.match(/^(.*?locale\/)([^/]+)\/([^/]+\.cfg)$/i);
      try {
        sources.push({
          namespace: `${match[1]}${match[3]}`,
          locale: match[2],
          path: entry.name,
          outputPath: `${match[1]}${targetLocale}/${match[3]}`,
          format: "factorio",
          data: parseFactorioLocale(await readEntryText(entry, entry.name)),
        });
      } catch (error) {
        warnings.push(`${entry.name}: ${error.message}`);
      }
    }
  } else if (game === "stardew") {
    const manifestEntry = archiveEntries.find(
      (entry) => !entry.dir && /(^|\/)manifest\.json$/i.test(entry.name),
    );
    const manifest = await parseJsonMetadata(manifestEntry);
    const root = manifestEntry?.name.replace(/manifest\.json$/i, "") || "";
    mod = {
      loader: "Content Patcher",
      id: cleanMetadataValue(manifest.UniqueID, sanitizeFileName(file.name)),
      name: cleanMetadataValue(manifest.Name, friendlyNameFromFilename(file.name)),
      version: cleanMetadataValue(manifest.Version, versionFromFilename(file.name) || "unknown"),
      root,
    };
    for (const entry of archiveEntries.filter(
      (candidate) => !candidate.dir && /(^|\/)i18n\/[^/]+\.json$/i.test(candidate.name),
    )) {
      const match = entry.name.match(/^(.*?i18n\/)([^/]+)\.json$/i);
      try {
        sources.push({
          namespace: match[1].replace(/\/$/, ""),
          locale: match[2],
          path: entry.name,
          outputPath: `${match[1]}${targetLocale}.json`,
          format: "json",
          data: validateLangMap(
            JSON.parse(await readEntryText(entry, entry.name)),
            entry.name,
          ),
        });
      } catch (error) {
        warnings.push(`${entry.name}: ${error.message}`);
      }
    }
  } else if (game === "rimworld") {
    const aboutEntry = archiveEntries.find(
      (entry) => !entry.dir && /(^|\/)about\/about\.xml$/i.test(entry.name),
    );
    const aboutText = aboutEntry
      ? await readEntryText(aboutEntry, aboutEntry.name, MAX_METADATA_TEXT_LENGTH)
      : "";
    const value = (name) =>
      decodeXmlText(aboutText.match(new RegExp(`<${name}>([^<]+)</${name}>`, "i"))?.[1] || "");
    const root = aboutEntry?.name.replace(/About\/About\.xml$/i, "") || "";
    mod = {
      loader: "RimWorld",
      id: cleanMetadataValue(value("packageId"), sanitizeFileName(file.name)),
      name: cleanMetadataValue(value("name"), friendlyNameFromFilename(file.name)),
      version: "unknown",
      root,
    };
    for (const entry of archiveEntries.filter(
      (candidate) =>
        !candidate.dir &&
        /(^|\/)languages\/[^/]+\/(?:keyed|definjected)\/.+\.xml$/i.test(candidate.name),
    )) {
      const match = entry.name.match(
        /^(.*?languages\/)([^/]+)\/((?:keyed|definjected)\/.+\.xml)$/i,
      );
      try {
        sources.push({
          namespace: `${match[1]}${match[3]}`,
          locale: match[2],
          path: entry.name,
          outputPath: `${match[1]}${targetLocale}/${match[3]}`,
          format: "rimworld",
          data: parseRimWorldLanguageXml(await readEntryText(entry, entry.name)),
        });
      } catch (error) {
        warnings.push(`${entry.name}: ${error.message}`);
      }
    }
  }

  if (!sources.length) return null;
  const grouped = new Map();
  for (const source of sources) {
    if (!grouped.has(source.namespace)) grouped.set(source.namespace, []);
    grouped.get(source.namespace).push(source);
  }

  const namespaces = [];
  const entries = [];
  for (const [namespace, candidates] of grouped) {
    const source = chooseGameSource(candidates, targetLocale);
    const existingTarget = candidates.find(
      (candidate) => candidate.locale.toLowerCase() === targetLocale.toLowerCase(),
    );
    const preserved = existingTarget ? { ...existingTarget.data } : {};
    const sourceLanguage = languageFromGameLocale(source.locale);
    const entryIds = [];
    for (const [key, sourceText] of Object.entries(source.data)) {
      const targetText = preserved[key];
      const sourceIsEmpty = !String(sourceText).trim();
      const languageMetadata = classifyEntryLanguage(sourceText, sourceLanguage);
      const sourceIsTarget =
        source.locale.toLowerCase() === targetLocale.toLowerCase() ||
        languageMetadata.sourceLanguage === language.id;
      const needsTranslation =
        !sourceIsEmpty &&
        !languageMetadata.translationBlocked &&
        !sourceIsTarget &&
        shouldTranslate(sourceText, targetText);
      const id = String(entries.length);
      entryIds.push(id);
      entries.push({
        id,
        namespace,
        key,
        source: sourceText,
        ...languageMetadata,
        sourceLocale: source.locale,
        translation: sourceIsEmpty
          ? ""
          : sourceIsTarget
            ? sourceText
            : needsTranslation || languageMetadata.translationBlocked
              ? ""
              : targetText ?? sourceText,
        status: sourceIsEmpty
          ? "excluded"
          : needsTranslation || languageMetadata.translationBlocked
            ? "pending"
            : "preserved",
        ignored: false,
        warning: "",
      });
    }
    namespaces.push({
      namespace,
      sourceLocale: source.locale,
      sourceLanguage,
      sourceLanguages: [sourceLanguage].filter(Boolean),
      sourcePath: source.path,
      outputPath: source.outputPath,
      format: source.format,
      existingTargetPath: existingTarget?.path || "",
      preserved,
      entryIds,
    });
  }
  const sourceLanguages = [
    ...new Set(entries.map((entry) => entry.sourceLanguage).filter(Boolean)),
  ];
  return {
    game,
    fileName: file.name,
    fileSize: Number(file.size || 0),
    mod,
    sourceLanguage: sourceLanguages.length === 1 ? sourceLanguages[0] : null,
    sourceLanguages,
    unsupportedSourceLocales: namespaces
      .filter((namespace) => !namespace.sourceLanguages.length)
      .map((namespace) => namespace.sourceLocale),
    targetLanguage: language.id,
    targetLocale,
    namespaces,
    entries,
    warnings,
    sourceBytes,
    createdAt: new Date().toISOString(),
  };
}

function inferMinecraftVersion(expression, fileName) {
  const candidates = `${expression || ""} ${fileName || ""}`.match(/(?:1\.\d+|2\d)\.\d+(?:\.\d+)?/g) || [];
  const value = candidates[0] || "";
  if (/^26\./.test(value)) return "26.1";
  const [major, minor = 0, patch = 0] = value.split(".").map(Number);
  if (major !== 1) return "1.21";
  if (minor >= 21) {
    if (patch >= 11) return "1.21.11";
    if (patch >= 9) return "1.21.9";
    if (patch >= 7) return "1.21.7";
    if (patch === 6) return "1.21.6";
    if (patch === 5) return "1.21.5";
    if (patch === 4) return "1.21.4";
    return "1.21";
  }
  if (minor === 20) {
    if (patch >= 5) return "1.20.5";
    if (patch >= 3) return "1.20.3";
    if (patch === 2) return "1.20.2";
    return "1.20";
  }
  if (minor === 19) return patch >= 4 ? "1.19.4" : patch === 3 ? "1.19.3" : "1.19";
  if (minor === 18) return "1.18";
  if (minor === 17) return "1.17";
  if (minor === 16) return patch >= 2 ? "1.16.2" : "1.15";
  if (minor >= 13) return "1.13";
  return "1.11";
}

function toBedrockLocale(locale) {
  const [language, region] = String(locale || "en_us").replace("-", "_").split("_");
  return region ? `${language.toLowerCase()}_${region.toUpperCase()}` : language.toLowerCase();
}

function artifactExtension(fileName, detection) {
  if (detection.id === "bedrock_addon") return ".mcaddon";
  if (detection.id === "bedrock_world") return ".mcworld";
  if (detection.id === "resource_pack" && detection.edition === "bedrock") return ".mcpack";
  if (detection.id === "server_plugin") return ".jar";
  const original = String(fileName).match(/\.(?:jar|zip|mrpack|mcpack|mcaddon|mcworld)$/i)?.[0];
  if (original) return original.toLowerCase();
  return ".zip";
}

async function analyzeDetectedArtifact(
  zip,
  archiveEntries,
  archiveData,
  file,
  detection,
  language,
  targetLocale,
) {
  const resolvedTargetLocale = detection.edition === "bedrock"
    ? toBedrockLocale(targetLocale)
    : targetLocale.toLowerCase();
  let totalTextBytes = 0;
  const countBytes = (length) => {
    totalTextBytes += length;
    if (totalTextBytes > MAX_TOTAL_LANG_BYTES) {
      throw new Error("翻訳対象ファイルの合計サイズが大きすぎます。");
    }
  };
  const readArtifactText = async (entry, label) => {
    const text = await readEntryText(entry, label);
    countBytes(new TextEncoder().encode(text).byteLength);
    return text;
  };
  const readArtifactBytes = async (entry, label, maxLength = MAX_LANG_TEXT_LENGTH) => {
    const bytes = await readEntryBytes(entry, label, maxLength);
    countBytes(bytes.byteLength);
    return bytes;
  };
  let totalWorldBytes = 0;
  const readWorldBytes = async (entry, label, maxLength) => {
    const bytes = await readEntryBytes(entry, label, maxLength);
    totalWorldBytes += bytes.byteLength;
    if (totalWorldBytes > 256 * 1024 * 1024) {
      throw new Error("ワールド内regionファイルの合計サイズが大きすぎます。");
    }
    return bytes;
  };
  const analysis = await analyzeArtifactDocuments(zip, detection, {
    targetLocale: resolvedTargetLocale,
    maxEntries: MAX_ARCHIVE_ENTRIES,
    maxExpandedBytes: MAX_ARCHIVE_BYTES * 4,
    readText: readArtifactText,
  });

  if (["modpack", "java_world", "resource_pack", "data_pack"].includes(detection.id)) {
    for (const container of analysis.containers) {
      const content = await extractMinecraftContentDocuments(
        Object.values(container.zip.files),
        {
          readText: readArtifactText,
          readBytes: readArtifactBytes,
          targetLocale: resolvedTargetLocale,
        },
      );
      for (const document of content.documents) {
        analysis.documents.push({ ...document, containerId: container.id });
      }
      analysis.warnings.push(...content.warnings);
    }
  }
  if (detection.id === "java_world") {
    const rootContainer = analysis.containers.find((container) => container.id === "root");
    const worldText = await extractJavaWorldRegionDocuments(
      Object.values(rootContainer.zip.files),
      { readBytes: readWorldBytes },
    );
    analysis.documents.push(...worldText.documents.map((document) => ({ ...document, containerId: "root" })));
    analysis.warnings.push(...worldText.warnings);
  }
  if (detection.id === "bedrock_world") {
    const rootContainer = analysis.containers.find((container) => container.id === "root");
    try {
      const { extractBedrockLevelDbDocuments } = await import("./bedrock-leveldb.js");
      const levelDb = await extractBedrockLevelDbDocuments(
        Object.values(rootContainer.zip.files),
        { readBytes: readWorldBytes },
      );
      analysis.documents.push(...levelDb.documents);
      analysis.warnings.push(...levelDb.warnings);
      analysis.levelDb = levelDb.metadata;
    } catch (error) {
      analysis.warnings.push(`Bedrock LevelDBは変更せず保持します: ${error.message}`);
      analysis.levelDb = null;
    }
  }

  const entries = [];
  const namespaces = [];
  let entryId = 0;
  for (const document of analysis.documents) {
    const namespaceEntryIds = [];
    const sourceLanguages = new Set();
    const declaredLanguage = languageFromMinecraftLocale(document.sourceLocale);
    document.records = document.records.map((record) => {
      const source = String(record.source ?? "");
      const existingTarget = record.existingTarget;
      const sourceIsEmpty = !source.trim();
      const languageMetadata = classifyEntryLanguage(source, declaredLanguage);
      if (languageMetadata.sourceLanguage) sourceLanguages.add(languageMetadata.sourceLanguage);
      const sourceIsTarget =
        languageMetadata.sourceLanguage === language.id ||
        String(document.sourceLocale).toLowerCase() === resolvedTargetLocale.toLowerCase();
      const needsTranslation =
        !sourceIsEmpty &&
        !languageMetadata.translationBlocked &&
        !sourceIsTarget &&
        shouldTranslate(source, existingTarget);
      const id = String(entryId++);
      namespaceEntryIds.push(id);
      entries.push({
        id,
        namespace: document.namespace,
        documentId: document.id,
        key: record.key || record.displayKey,
        source,
        ...languageMetadata,
        sourceLocale: document.sourceLocale,
        translation: sourceIsEmpty
          ? ""
          : sourceIsTarget
            ? source
            : needsTranslation || languageMetadata.translationBlocked
              ? ""
              : existingTarget ?? source,
        status: sourceIsEmpty
          ? "excluded"
          : needsTranslation || languageMetadata.translationBlocked
            ? "pending"
            : "preserved",
        ignored: false,
        warning: "",
        contentKind: document.format,
        sourcePath: document.sourcePath,
      });
      return { ...record, entryId: id };
    });
    const detectedLanguages = [...sourceLanguages];
    namespaces.push({
      namespace: document.namespace,
      documentId: document.id,
      sourceLocale: document.sourceLocale,
      sourceLanguage: detectedLanguages.length === 1 ? detectedLanguages[0] : null,
      sourceLanguages: detectedLanguages,
      sourcePath: document.sourcePath,
      outputPath: document.outputPath,
      format: document.format,
      entryIds: namespaceEntryIds,
      preserved: document.preserved || {},
    });
  }

  const warnings = [...analysis.warnings];
  const nestedArchives = Math.max(0, analysis.containers.length - 1);
  const missingReferences = Math.max(0, analysis.referencedFiles - nestedArchives);
  if (missingReferences) {
    warnings.push(`マニフェスト参照のみのファイルが${missingReferences}件あります。インストール済みのパックZIPを追加すると解析できます。`);
  }
  if (
    detection.id === "bedrock_world" &&
    !analysis.levelDb &&
    !warnings.some((warning) => warning.startsWith("Bedrock LevelDB"))
  ) {
    warnings.push("Bedrock LevelDBを安全に解析できなかったため、データベースは変更しません。");
  }
  if (detection.id === "server_plugin") {
    warnings.push("プラグインごとに言語ファイルの読込方法が異なるため、導入後にサーバー上で確認してください。");
  }

  const sourceLanguages = [...new Set(entries.map((entry) => entry.sourceLanguage).filter(Boolean))];
  let name = friendlyNameFromFilename(file.name);
  if (detection.id === "server_plugin") {
    const descriptor = archiveEntries.find(
      (entry) => !entry.dir && /(^|\/)(?:plugin|paper-plugin|bungee)\.yml$/i.test(entry.name),
    );
    if (descriptor) {
      try {
        const text = await readArtifactText(descriptor, descriptor.name);
        const declaredName = text.match(/^\s*name\s*:\s*["']?([^\r\n"']+)/im)?.[1]?.trim();
        if (declaredName) name = declaredName;
      } catch {
        // Fall back to the archive filename when plugin metadata is unreadable.
      }
    }
  }
  const artifact = {
    ...detection,
    extension: artifactExtension(file.name, detection),
    translatableDocuments: analysis.documents.length,
    referencedFiles: analysis.referencedFiles,
    analyzedContainers: analysis.containers.length,
  };
  return {
    game: "minecraft",
    edition: detection.edition,
    artifactType: detection.id,
    artifact,
    fileName: file.name,
    fileSize: Number(file.size || 0),
    mod: {
      loader: detection.label,
      id: sanitizeFileName(name).toLowerCase(),
      name,
      version: "unknown",
      minecraft: "",
    },
    sourceLanguage: sourceLanguages.length === 1 ? sourceLanguages[0] : null,
    sourceLanguages,
    unsupportedSourceLocales: namespaces.filter((item) => !item.sourceLanguages.length).map((item) => item.sourceLocale),
    targetLanguage: language.id,
    targetLocale: resolvedTargetLocale,
    minecraftVersion: inferMinecraftVersion("", file.name),
    namespaces,
    documents: analysis.documents,
    entries,
    warnings,
    contentKinds: [...new Set(analysis.documents.map((document) => document.format))],
    requiresInstanceInstall: ["modpack", "java_world", "server_plugin"].includes(detection.id),
    outputPlans: [{ id: "native", recommended: true, extension: artifact.extension }],
    coverage: {
      documents: analysis.documents.length,
      containers: analysis.containers.length,
      referenced: analysis.referencedFiles,
      missingReferences,
    },
    artifactState: {
      sourceBytes: archiveData instanceof Uint8Array ? archiveData : new Uint8Array(archiveData),
      levelDb: analysis.levelDb,
      containers: analysis.containers.map((container) => ({
        id: container.id,
        parentId: container.parentId,
        entryPath: container.entryPath,
        sourceBytes: container.sourceBytes,
        rootPrefix: container.rootPrefix || "",
      })),
    },
    createdAt: new Date().toISOString(),
  };
}

export async function analyzeArchive(
  file,
  { targetLanguage = DEFAULT_TARGET_LANGUAGE, targetLocale } = {},
) {
  const language = getTargetLanguage(targetLanguage);
  const resolvedTargetLocale = targetLocale || language.minecraftLocale;
  if (!file?.name || !/\.(jar|zip|mrpack|mcpack|mcaddon|mcworld)$/i.test(file.name)) {
    throw new Error("対応する .jar / .zip / .mrpack / .mcpack / .mcaddon / .mcworld を選択してください。");
  }
  if (Number(file.size || 0) > MAX_ARCHIVE_BYTES) {
    throw new Error("512MBを超えるファイルには対応していません。");
  }

  let zip;
  let archiveData;
  try {
    archiveData = typeof file.arrayBuffer === "function" ? await file.arrayBuffer() : file;
    zip = await JSZip.loadAsync(archiveData, { createFolders: false });
  } catch (error) {
    throw new Error(`アーカイブを開けませんでした。破損していないか確認してください。 (${error.message})`);
  }

  const archiveEntries = Object.values(zip.files);
  if (archiveEntries.length > MAX_ARCHIVE_ENTRIES) {
    throw new Error("アーカイブ内のファイル数が多すぎます。");
  }
  archiveEntries.forEach(assertSafeArchivePath);

  const detectedArtifact = await detectArtifactType(zip, file.name);
  if (detectedArtifact) {
    return analyzeDetectedArtifact(
      zip,
      archiveEntries,
      archiveData,
      file,
      detectedArtifact,
      language,
      resolvedTargetLocale,
    );
  }

  let totalContentLength = 0;
  const readMinecraftContentText = async (entry, label) => {
    const text = await readEntryText(entry, label);
    totalContentLength += text.length;
    if (totalContentLength > MAX_TOTAL_LANG_BYTES) {
      throw new Error("翻訳対象ファイルの合計サイズが大きすぎます。");
    }
    return text;
  };
  const readMinecraftContentBytes = async (entry, label) => {
    const bytes = await readEntryBytes(entry, label);
    totalContentLength += bytes.byteLength;
    if (totalContentLength > MAX_TOTAL_LANG_BYTES) {
      throw new Error("翻訳対象ファイルの合計サイズが大きすぎます。");
    }
    return bytes;
  };
  const minecraftContent = await extractMinecraftContentDocuments(
    archiveEntries,
    {
      readText: readMinecraftContentText,
      readBytes: readMinecraftContentBytes,
      targetLocale: resolvedTargetLocale,
    },
  );
  const langEntries = archiveEntries.filter(
    (entry) => !entry.dir && /^assets\/[^/]+\/lang\/[^/]+\.(json|lang)$/i.test(entry.name),
  );
  if (!langEntries.length && !minecraftContent.documents.length) {
    const detectedGame = archiveEntries.some(
      (entry) => !entry.dir && /(^|\/)locale\/[^/]+\/[^/]+\.cfg$/i.test(entry.name),
    )
      ? "factorio"
      : archiveEntries.some(
            (entry) => !entry.dir && /(^|\/)i18n\/(?:default|en)\.json$/i.test(entry.name),
          )
        ? "stardew"
        : archiveEntries.some(
              (entry) =>
                !entry.dir &&
                /(^|\/)languages\/[^/]+\/(?:keyed|definjected)\/.+\.xml$/i.test(entry.name),
            )
          ? "rimworld"
          : null;
    if (detectedGame) {
      const project = await analyzeGameArchive(
        archiveEntries,
        file,
        detectedGame,
        language.id,
        archiveData instanceof Uint8Array ? archiveData : new Uint8Array(archiveData),
      );
      if (project) return project;
    }
    throw new Error("対応する言語ファイルが見つかりません。");
  }

  const declaredLangBytes = langEntries.reduce(
    (total, entry) => total + (getDeclaredUncompressedSize(entry) || 0),
    0,
  );
  if (declaredLangBytes > MAX_TOTAL_LANG_BYTES) {
    throw new Error("langファイルの展開後サイズが大きすぎます。");
  }

  const warnings = [...minecraftContent.warnings];
  const sources = [];
  let totalLangLength = 0;
  for (const entry of langEntries) {
    const match = entry.name.match(/^assets\/([^/]+)\/lang\/([^/]+)\.(json|lang)$/i);
    if (!VALID_NAMESPACE_PATTERN.test(match[1])) {
      warnings.push(`${entry.name} を読み飛ばしました: namespaceに使用できない文字があります`);
      continue;
    }
    try {
      const text = await readEntryText(entry, entry.name);
      totalLangLength += text.length;
      if (totalLangLength > MAX_TOTAL_LANG_BYTES) {
        throw new Error("langファイルの合計サイズが大きすぎます。");
      }
      const data =
        match[3].toLowerCase() === "json"
          ? validateLangMap(JSON.parse(text), entry.name)
          : parseLegacyLang(text);
      sources.push({
        namespace: match[1],
        locale: match[2].toLowerCase(),
        ext: match[3].toLowerCase(),
        path: entry.name,
        data,
      });
    } catch (error) {
      if (totalLangLength > MAX_TOTAL_LANG_BYTES) throw error;
      warnings.push(`${entry.name} を読み飛ばしました: ${error.message}`);
    }
  }
  if (!sources.length && !minecraftContent.documents.length) {
    throw new Error("読み込めるlangファイルがありませんでした。");
  }

  const grouped = new Map();
  for (const source of sources) {
    if (!grouped.has(source.namespace)) grouped.set(source.namespace, []);
    grouped.get(source.namespace).push(source);
  }
  const detectedNamespaces = [
    ...new Set([
      ...grouped.keys(),
      ...minecraftContent.documents.map((document) => document.namespaceId),
    ]),
  ];
  const mod = await detectModMetadata(
    archiveEntries,
    file.name,
    detectedNamespaces,
  );
  const namespaces = [];
  const entries = [];
  let entryId = 0;

  for (const [namespace, namespaceSources] of grouped) {
    const source = chooseSource(namespaceSources, resolvedTargetLocale);
    const localeLanguage = languageFromMinecraftLocale(source.locale);
    const existingTarget = namespaceSources.find(
      (candidate) => candidate.locale === resolvedTargetLocale && candidate.ext === "json",
    ) || namespaceSources.find((candidate) => candidate.locale === resolvedTargetLocale);
    const preserved = existingTarget ? { ...existingTarget.data } : {};
    const namespaceEntryIds = [];
    const namespaceSourceLanguages = new Set();

    for (const [key, sourceText] of Object.entries(source.data)) {
      const targetText = preserved[key];
      const sourceIsEmpty = !String(sourceText).trim();
      const languageMetadata = classifyEntryLanguage(
        sourceText,
        localeLanguage,
      );
      const { sourceLanguage } = languageMetadata;
      if (sourceLanguage) namespaceSourceLanguages.add(sourceLanguage);
      const sourceIsTarget =
        source.locale === resolvedTargetLocale || sourceLanguage === language.id;
      const needsTranslation =
        !sourceIsEmpty &&
        !languageMetadata.translationBlocked &&
        !sourceIsTarget &&
        shouldTranslate(sourceText, targetText);
      const id = String(entryId++);
      namespaceEntryIds.push(id);
      entries.push({
        id,
        namespace,
        key,
        source: sourceText,
        ...languageMetadata,
        sourceLocale: source.locale,
        translation: sourceIsEmpty
          ? ""
          : sourceIsTarget
          ? sourceText
          : needsTranslation
            ? ""
            : languageMetadata.translationBlocked
              ? ""
              : targetText ?? sourceText,
        status: sourceIsEmpty
          ? "excluded"
          : needsTranslation || languageMetadata.translationBlocked
          ? "pending"
          : "preserved",
        ignored: false,
        warning: "",
      });
    }

    const detectedSourceLanguages = [...namespaceSourceLanguages];
    namespaces.push({
      namespace,
      sourceLocale: source.locale,
      sourceLanguage:
        detectedSourceLanguages.length === 1 ? detectedSourceLanguages[0] : null,
      sourceLanguages: detectedSourceLanguages,
      sourcePath: source.path,
      existingTargetPath: existingTarget?.path || "",
      preserved,
      entryIds: namespaceEntryIds,
    });
  }

  for (const document of minecraftContent.documents) {
    const localeLanguage = languageFromMinecraftLocale(document.sourceLocale);
    const namespaceEntryIds = [];
    const namespaceSourceLanguages = new Set();
    document.records = document.records.map((record) => {
      const sourceText = record.source;
      const targetText = record.existingTarget;
      const sourceIsEmpty = !String(sourceText).trim();
      const languageMetadata = classifyEntryLanguage(
        sourceText,
        localeLanguage,
      );
      const { sourceLanguage } = languageMetadata;
      if (sourceLanguage) namespaceSourceLanguages.add(sourceLanguage);
      const sourceIsTarget =
        document.sourceLocale === resolvedTargetLocale ||
        sourceLanguage === language.id;
      const needsTranslation =
        !sourceIsEmpty &&
        !languageMetadata.translationBlocked &&
        !sourceIsTarget &&
        shouldTranslate(sourceText, targetText);
      const id = String(entryId++);
      namespaceEntryIds.push(id);
      entries.push({
        id,
        namespace: document.namespace,
        key: record.displayKey,
        source: sourceText,
        ...languageMetadata,
        sourceLocale: document.sourceLocale,
        translation: sourceIsEmpty
          ? ""
          : sourceIsTarget
            ? sourceText
            : needsTranslation
              ? ""
              : languageMetadata.translationBlocked
                ? ""
                : targetText ?? sourceText,
        status: sourceIsEmpty
          ? "excluded"
          : needsTranslation || languageMetadata.translationBlocked
            ? "pending"
            : "preserved",
        ignored: false,
        warning: "",
        contentKind: document.kind,
        contentFormat: document.format,
        sourcePath: document.sourcePath,
      });
      return { ...record, entryId: id };
    });

    const detectedSourceLanguages = [...namespaceSourceLanguages];
    namespaces.push({
      namespace: document.namespace,
      sourceLocale: document.sourceLocale,
      sourceLanguage:
        detectedSourceLanguages.length === 1
          ? detectedSourceLanguages[0]
          : null,
      sourceLanguages: detectedSourceLanguages,
      sourcePath: document.sourcePath,
      outputPath: document.outputPath,
      existingTargetPath: document.existingTargetPath,
      preserved: {},
      entryIds: namespaceEntryIds,
      format: document.format,
      contentKind: document.kind,
      contentDocument: document,
      requiresInstanceInstall: document.requiresInstanceInstall,
    });
  }

  const sourceLanguages = [
    ...new Set(entries.map((entry) => entry.sourceLanguage).filter(Boolean)),
  ];
  const unsupportedSourceLocales = [
    ...new Set(
      namespaces
        .filter((namespace) => !namespace.sourceLanguages.length)
        .map((namespace) => namespace.sourceLocale),
    ),
  ];

  return {
    game: "minecraft",
    fileName: file.name,
    fileSize: Number(file.size || 0),
    mod,
    sourceLanguage: sourceLanguages.length === 1 ? sourceLanguages[0] : null,
    sourceLanguages,
    unsupportedSourceLocales,
    targetLanguage: language.id,
    targetLocale: resolvedTargetLocale,
    minecraftVersion: inferMinecraftVersion(mod.minecraft, file.name),
    namespaces,
    entries,
    warnings,
    contentKinds: minecraftContent.kinds,
    requiresInstanceInstall: minecraftContent.requiresInstanceInstall,
    sourceBytes: archiveData instanceof Uint8Array ? archiveData : new Uint8Array(archiveData),
    createdAt: new Date().toISOString(),
  };
}

function combineModpackWithLocalMods(modpack, supplements) {
  const entries = modpack.entries.map((entry) => ({ ...entry }));
  const namespaces = modpack.namespaces.map((namespace) => ({
    ...namespace,
    entryIds: [...namespace.entryIds],
  }));
  const documents = [...(modpack.documents || [])];

  for (const [supplementIndex, supplement] of supplements.entries()) {
    const sourceEntries = new Map(supplement.entries.map((entry) => [entry.id, entry]));
    for (const namespace of supplement.namespaces) {
      const idMap = new Map();
      for (const sourceId of namespace.entryIds) {
        const sourceEntry = sourceEntries.get(sourceId);
        if (!sourceEntry) continue;
        const id = String(entries.length);
        idMap.set(sourceId, id);
        entries.push({
          ...sourceEntry,
          id,
          modId: supplement.mod.id,
          modName: supplement.mod.name,
          sourceFileName: supplement.fileName,
          supplementIndex,
          sourceEntryId: sourceId,
        });
      }

      const entryIds = namespace.entryIds.map((id) => idMap.get(id)).filter((id) => id !== undefined);
      if (!entryIds.length) continue;
      const containerId = `local-mod:${supplementIndex}`;
      let document;
      if (namespace.contentDocument) {
        document = {
          ...namespace.contentDocument,
          id: `${containerId}:${namespace.contentDocument.id || namespace.sourcePath}`,
          containerId,
          records: namespace.contentDocument.records
            .map((record) => ({ ...record, entryId: idMap.get(record.entryId) }))
            .filter((record) => record.entryId !== undefined),
        };
      } else {
        const extension = /\.lang$/i.test(namespace.sourcePath || "") ? "lang" : "json";
        document = {
          id: `${containerId}:${namespace.namespace}`,
          containerId,
          format: extension === "json" ? "java-json-lang" : "java-legacy-lang",
          sourcePath: namespace.sourcePath,
          outputPath: `assets/${namespace.namespace}/lang/${modpack.targetLocale}.${extension}`,
          sourceLocale: namespace.sourceLocale,
          namespace: namespace.namespace,
          data: {},
          preserved: namespace.preserved || {},
          records: namespace.entryIds
            .map((sourceId) => {
              const sourceEntry = sourceEntries.get(sourceId);
              const entryId = idMap.get(sourceId);
              return sourceEntry && entryId !== undefined
                ? { key: sourceEntry.key, source: sourceEntry.source, existingTarget: sourceEntry.translation || undefined, entryId }
                : null;
            })
            .filter(Boolean),
        };
      }
      documents.push(document);
      namespaces.push({
        ...namespace,
        namespace: `${supplement.mod.name} · ${namespace.namespace}`,
        entryIds,
        contentDocument: document,
      });
    }
  }

  const previousMissing = Number(modpack.coverage?.missingReferences || 0);
  const supplied = supplements.length;
  const missingReferences = Math.max(0, previousMissing - supplied);
  const warnings = (modpack.warnings || []).filter((warning) => !/^マニフェスト参照のみのファイルが\d+件/.test(warning));
  warnings.push(`${supplied}件のローカルMODをModPackの翻訳対象へ追加しました。`);
  if (missingReferences) warnings.push(`索引上の未解析ファイルがあと${missingReferences}件あります。必要なら対応するMODを追加してください。`);

  return {
    ...modpack,
    fileName: modpack.fileName,
    fileNames: [modpack.fileName, ...supplements.map((project) => project.fileName)],
    fileSize: Number(modpack.fileSize || 0) + supplements.reduce((total, project) => total + Number(project.fileSize || 0), 0),
    namespaces,
    documents,
    entries,
    warnings,
    supplementProjects: supplements,
    coverage: {
      ...(modpack.coverage || {}),
      missingReferences,
      suppliedLocalMods: supplied,
    },
  };
}

export function combineProjects(projects) {
  const validProjects = (projects || []).filter(Boolean);
  if (!validProjects.length) {
    throw new Error("統合するMODがありません。");
  }
  if (validProjects.length === 1) return validProjects[0];
  if (validProjects.length > MAX_BATCH_FILES) {
    throw new Error(`一度に選択できるMODは${MAX_BATCH_FILES}件までです。`);
  }
  const totalBytes = validProjects.reduce(
    (total, project) => total + Number(project.fileSize || 0),
    0,
  );
  if (totalBytes > MAX_BATCH_BYTES) {
    throw new Error("選択したMODの合計サイズは1GBまでです。");
  }

  const modpacks = validProjects.filter((project) => project.artifactType === "modpack");
  const localModSupplements = validProjects.filter((project) => !project.artifactState && (project.game || "minecraft") === "minecraft");
  if (modpacks.length === 1 && localModSupplements.length === validProjects.length - 1) {
    return combineModpackWithLocalMods(modpacks[0], localModSupplements);
  }

  if (validProjects.some((project) => project.artifactState)) {
    const targetLanguage = validProjects[0].targetLanguage;
    if (validProjects.some((project) => project.targetLanguage !== targetLanguage)) {
      throw new Error("翻訳先が異なるプロジェクトは統合できません。");
    }
    const entries = [];
    const namespaces = [];
    const warnings = [];
    for (const [projectIndex, project] of validProjects.entries()) {
      warnings.push(...(project.warnings || []).map((warning) => `${project.fileName}: ${warning}`));
      const idMap = new Map();
      for (const sourceEntry of project.entries) {
        const id = String(entries.length);
        idMap.set(sourceEntry.id, id);
        entries.push({
          ...sourceEntry,
          id,
          modName: project.mod.name,
          sourceProjectIndex: projectIndex,
          sourceEntryId: sourceEntry.id,
        });
      }
      for (const namespace of project.namespaces) {
        namespaces.push({
          ...namespace,
          namespace: `${project.mod.name} · ${namespace.namespace}`,
          entryIds: namespace.entryIds.map((id) => idMap.get(id)).filter((id) => id !== undefined),
        });
      }
    }
    return {
      game: "minecraft",
      artifactType: "batch",
      artifactBatch: true,
      fileName: `${validProjects.length}-files`,
      fileNames: validProjects.map((project) => project.fileName),
      fileSize: totalBytes,
      mod: { loader: "Multiple formats", id: "babel_breaker_batch", name: `${validProjects.length} files`, version: "batch" },
      mods: validProjects.map((project) => ({ ...project.mod })),
      targetLanguage,
      targetLocale: validProjects[0].targetLocale,
      minecraftVersion: validProjects[0].minecraftVersion,
      sourceLanguages: [...new Set(validProjects.flatMap((project) => project.sourceLanguages || []))],
      unsupportedSourceLocales: [...new Set(validProjects.flatMap((project) => project.unsupportedSourceLocales || []))],
      namespaces,
      entries,
      warnings,
      sourceProjects: validProjects,
      isBatch: true,
      createdAt: new Date().toISOString(),
    };
  }

  const targetLanguage = validProjects[0].targetLanguage;
  const targetLocale = validProjects[0].targetLocale;
  const game = validProjects[0].game || "minecraft";
  if (validProjects.some((project) => (project.game || "minecraft") !== game)) {
    throw new Error("異なるゲームのMODは同じ一括出力にまとめられません。");
  }
  if (
    validProjects.some(
      (project) =>
        project.targetLanguage !== targetLanguage ||
        project.targetLocale !== targetLocale,
    )
  ) {
    throw new Error("翻訳先が異なるプロジェクトは統合できません。");
  }

  const warnings = [];
  const entries = [];
  const namespaceMap = new Map();
  const entryMap = new Map();

  for (const [projectIndex, project] of validProjects.entries()) {
    for (const warning of project.warnings || []) {
      warnings.push(`${project.fileName}: ${warning}`);
    }

    const sourceEntries = new Map(
      project.entries.map((entry) => [entry.id, entry]),
    );
    for (const namespace of project.namespaces) {
      let combinedNamespace = namespaceMap.get(namespace.namespace);
      if (!combinedNamespace) {
        combinedNamespace = {
          namespace: namespace.namespace,
          sourceLocale: namespace.sourceLocale,
          sourceLanguage: namespace.sourceLanguage,
          sourceLocales: [],
          sourceLanguages: [],
          sourcePath: namespace.sourcePath,
          outputPath: namespace.outputPath,
          format: namespace.format,
          contentKind: namespace.contentKind,
          contentDocument: namespace.contentDocument
            ? { ...namespace.contentDocument, records: [] }
            : null,
          requiresInstanceInstall: Boolean(namespace.requiresInstanceInstall),
          existingTargetPath: namespace.existingTargetPath,
          preserved: {},
          entryIds: [],
        };
        namespaceMap.set(namespace.namespace, combinedNamespace);
      }
      if (
        namespace.sourceLocale &&
        !combinedNamespace.sourceLocales.includes(namespace.sourceLocale)
      ) {
        combinedNamespace.sourceLocales.push(namespace.sourceLocale);
      }
      const detectedLanguages = namespace.sourceLanguages?.length
        ? namespace.sourceLanguages
        : [namespace.sourceLanguage].filter(Boolean);
      for (const detectedLanguage of detectedLanguages) {
        if (!combinedNamespace.sourceLanguages.includes(detectedLanguage)) {
          combinedNamespace.sourceLanguages.push(detectedLanguage);
        }
      }
      for (const [key, value] of Object.entries(namespace.preserved || {})) {
        if (!Object.hasOwn(combinedNamespace.preserved, key)) {
          defineOwnValue(combinedNamespace.preserved, key, value);
        }
      }

      for (const sourceId of namespace.entryIds) {
        const sourceEntry = sourceEntries.get(sourceId);
        if (!sourceEntry) continue;
        const collisionKey =
          game === "minecraft"
            ? `${namespace.namespace}\u0000${sourceEntry.key}`
            : `${projectIndex}\u0000${namespace.namespace}\u0000${sourceEntry.key}`;
        const existingEntry = entryMap.get(collisionKey);
        if (existingEntry) {
          if (existingEntry.source === sourceEntry.source) {
            if (
              !existingEntry.translation.trim() &&
              sourceEntry.translation.trim()
            ) {
              existingEntry.translation = sourceEntry.translation;
              existingEntry.status = sourceEntry.status;
              existingEntry.warning = sourceEntry.warning;
            }
            continue;
          }
          warnings.push(
            `${namespace.namespace}:${sourceEntry.key} は複数MODで内容が異なるため、${existingEntry.modName} の原文を使用します。`,
          );
          continue;
        }

        const id = String(entries.length);
        const entry = {
          ...sourceEntry,
          id,
          modId: project.mod.id,
          modName: project.mod.name,
          sourceFileName: project.fileName,
          sourceProjectIndex: projectIndex,
          sourceEntryId: sourceEntry.id,
        };
        entries.push(entry);
        entryMap.set(collisionKey, entry);
        combinedNamespace.entryIds.push(id);
        if (combinedNamespace.contentDocument && namespace.contentDocument) {
          const sourceRecord = namespace.contentDocument.records.find(
            (record) => record.entryId === sourceId,
          );
          if (sourceRecord) {
            combinedNamespace.contentDocument.records.push({
              ...sourceRecord,
              entryId: id,
            });
          }
        }
      }
    }
  }

  const namespaces = [...namespaceMap.values()].map((namespace) => ({
    ...namespace,
    sourceLocale:
      namespace.sourceLocales.length === 1
        ? namespace.sourceLocales[0]
        : namespace.sourceLocales.join(", "),
    sourceLanguage:
      namespace.sourceLanguages.length === 1
        ? namespace.sourceLanguages[0]
        : null,
  }));
  const sourceLanguages = [
    ...new Set(validProjects.flatMap((project) => project.sourceLanguages || [])),
  ];
  const unsupportedSourceLocales = [
    ...new Set(
      validProjects.flatMap(
        (project) => project.unsupportedSourceLocales || [],
      ),
    ),
  ];
  const versionIndexes = validProjects
    .map((project) =>
      MINECRAFT_VERSIONS.findIndex(
        (version) => version.id === project.minecraftVersion,
      ),
    )
    .filter((index) => index >= 0);
  const minecraftVersion =
    game === "minecraft"
      ? MINECRAFT_VERSIONS[Math.min(...versionIndexes)]?.id ||
        validProjects[0].minecraftVersion
      : undefined;
  const loaders = [...new Set(validProjects.map((project) => project.mod.loader))];

  return {
    game,
    fileName: `${validProjects.length}-mods`,
    fileNames: validProjects.map((project) => project.fileName),
    fileSize: totalBytes,
    mod: {
      loader: loaders.join(" + "),
      id: "babel_breaker_batch",
      name: `${validProjects.length} MODs`,
      version: "batch",
      minecraft: validProjects
        .map((project) => project.mod.minecraft)
        .filter(Boolean)
        .join(", "),
    },
    mods: validProjects.map((project) => ({ ...project.mod })),
    sourceLanguage: sourceLanguages.length === 1 ? sourceLanguages[0] : null,
    sourceLanguages,
    unsupportedSourceLocales,
    targetLanguage,
    targetLocale,
    minecraftVersion,
    namespaces,
    entries,
    warnings,
    contentKinds: [
      ...new Set(validProjects.flatMap((project) => project.contentKinds || [])),
    ],
    requiresInstanceInstall: validProjects.some(
      (project) => project.requiresInstanceInstall,
    ),
    sourceProjects: validProjects,
    createdAt: new Date().toISOString(),
    isBatch: true,
  };
}

export function createDemoProject({
  targetLanguage = DEFAULT_TARGET_LANGUAGE,
  targetLocale,
} = {}) {
  const language = getTargetLanguage(targetLanguage);
  const entries = [
    ["block.babel_breaker.arcane_forge", "Arcane Forge", "秘術の鍛冶台"],
    ["item.babel_breaker.mana_crystal", "Mana Crystal", "マナクリスタル"],
    ["gui.babel_breaker.energy", "Energy: %s / %s", "エネルギー: %s / %s"],
    ["message.babel_breaker.welcome", "Welcome, %1$s!", "ようこそ、%1$s！"],
  ].map(([key, source, translation], index) => ({
    id: String(index),
    namespace: "babel_breaker",
    key,
    source,
    sourceLanguage: "en",
    sourceLocale: "en_us",
    translation,
    status: "translated",
    warning: "",
  }));
  return {
    game: "minecraft",
    fileName: "babel-breaker-demo-1.21.1.jar",
    fileSize: 42_240,
    mod: {
      loader: "Fabric",
      id: "babel_breaker",
      name: "Babel Breaker Demo",
      version: "1.0.0",
      minecraft: "1.21.1",
    },
    sourceLanguage: "en",
    sourceLanguages: ["en"],
    unsupportedSourceLocales: [],
    targetLanguage: language.id,
    targetLocale: targetLocale || language.minecraftLocale,
    minecraftVersion: "1.21",
    namespaces: [
      {
        namespace: "babel_breaker",
        sourceLocale: "en_us",
        sourceLanguage: "en",
        sourcePath: "assets/babel_breaker/lang/en_us.json",
        existingTargetPath: "",
        preserved: {},
        entryIds: entries.map((entry) => entry.id),
      },
    ],
    entries,
    warnings: [],
    createdAt: new Date().toISOString(),
    isDemo: true,
  };
}

export function getProjectStats(project) {
  const states = project.entries.map(getEntryWorkflowState);
  const pending = states.filter((state) => state === "pending").length;
  const errors = states.filter((state) => state === "error").length;
  const ambiguous = states.filter((state) => state === "ambiguous").length;
  const review = states.filter((state) => state === "review").length;
  const ignored = states.filter((state) => state === "ignored").length;
  const excluded = states.filter((state) => state === "excluded").length;
  const warnings = errors;
  const needsReview = pending + errors + ambiguous + review;
  const preserved = project.entries.filter((entry) => entry.status === "preserved").length;
  const output = project.entries.filter(shouldIncludeEntryInOutput).length;
  return {
    total: project.entries.length,
    pending,
    translated: states.filter((state) =>
      ["review", "complete"].includes(state),
    ).length,
    warnings,
    errors,
    ambiguous,
    review,
    ignored,
    excluded,
    output,
    omitted: project.entries.length - output,
    needsReview,
    preserved,
    namespaces: project.namespaces?.length || 0,
  };
}

export function getEntryWorkflowState(entry) {
  if (entry.ignored) return "ignored";
  if (!String(entry.source || "").trim()) return "excluded";
  if (entry.warning) return "error";
  if (entry.translationBlocked) return "ambiguous";
  if (!String(entry.translation || "").trim()) return "pending";
  if (
    entry.status === "translated" ||
    (entry.languageConflict && !entry.languageConfirmed)
  ) {
    return "review";
  }
  return "complete";
}

export function shouldIncludeEntryInOutput(entry) {
  if (entry.ignored || !String(entry.source || "").trim()) return false;
  if (!String(entry.translation || "").trim() || entry.warning) return false;
  return placeholdersMatch(entry.source, entry.translation);
}

export function buildClipboardPayload(project) {
  const translations = {};
  const entriesById = new Map(project.entries.map((entry) => [entry.id, entry]));
  for (const namespace of project.namespaces) {
    const values = {};
    for (const id of namespace.entryIds) {
      const entry = entriesById.get(id);
      if (
        entry &&
        !entry.ignored &&
        String(entry.source || "").trim() &&
        !entry.translation.trim()
      ) {
        defineOwnValue(values, entry.key, entry.source);
      }
    }
    if (Object.keys(values).length) {
      defineOwnValue(translations, namespace.namespace, values);
    }
  }

  const namespaces = Object.keys(translations);
  if (namespaces.length === 1) {
    return JSON.stringify(translations[namespaces[0]], null, 2);
  }
  return JSON.stringify({ translations }, null, 2);
}

export function buildTranslationRequest(project) {
  const target = getTargetLanguage(project.targetLanguage);
  const game = SUPPORTED_GAMES[project.game || "minecraft"];
  const sourceLines = project.namespaces.map((namespace) => {
    const sourceLanguages = namespace.sourceLanguages?.length
      ? namespace.sourceLanguages
      : [namespace.sourceLanguage].filter(Boolean);
    const sourceNames = sourceLanguages
      .map(getSourceLanguage)
      .filter(Boolean)
      .map((language) => `${language.englishName} (${language.nativeName})`);
    const sourceLocales = namespace.sourceLocales?.length
      ? namespace.sourceLocales
      : [namespace.sourceLocale].filter(Boolean);
    const sourceName = sourceNames.length
      ? sourceNames.join(" / ")
      : `the language identified by locale ${sourceLocales.join(", ")}`;
    return `- ${namespace.namespace}: ${sourceName} [${sourceLocales.join(", ")}]`;
  });
  return [
    `The following is ${game.name} mod language data represented as JSON.`,
    "The source language was detected from each language filename and its contents:",
    ...sourceLines,
    `Translate only the values into ${target.englishName} (${target.nativeName}). Never change a key.`,
    "Use each namespace's detected source language. Use concise, natural wording suitable for short in-game UI text.",
    "Preserve every formatting token exactly, including %s, %1$d, {0}, {team}, §a, Patchouli $(...) codes, line breaks, and URLs.",
    "Return only JSON with the same structure. Do not add explanations or Markdown.",
    "",
    buildClipboardPayload(project),
  ].join("\n");
}

function extractJsonText(text) {
  const trimmed = String(text || "").trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return fenced ? fenced[1].trim() : trimmed;
}

export function applyClipboardTranslation(project, text) {
  let parsed;
  try {
    parsed = JSON.parse(extractJsonText(text));
  } catch {
    throw new Error("貼り付けた内容をJSONとして読み取れませんでした。");
  }
  if (!isPlainObject(parsed)) throw new Error("翻訳結果はJSONオブジェクトにしてください。");

  let bundle = parsed.translations && isPlainObject(parsed.translations) ? parsed.translations : parsed;
  const nested = Object.values(bundle).some((value) => isPlainObject(value));
  if (!nested) {
    if (project.namespaces.length !== 1) {
      throw new Error("複数namespaceのMODでは、コピーしたJSONと同じ入れ子構造で貼り付けてください。");
    }
    bundle = { [project.namespaces[0].namespace]: bundle };
  }

  let applied = 0;
  let rejected = 0;
  for (const entry of project.entries) {
    if (!Object.hasOwn(bundle, entry.namespace)) continue;
    const namespaceBundle = bundle[entry.namespace];
    if (!isPlainObject(namespaceBundle) || !Object.hasOwn(namespaceBundle, entry.key)) continue;
    const translated = namespaceBundle[entry.key];
    if (typeof translated !== "string") continue;
    if (
      !translated.trim() ||
      translated.includes("\uFFFD") ||
      !placeholdersMatch(entry.source, translated)
    ) {
      entry.warning = "プレースホルダーが一致しないため適用しませんでした";
      rejected += 1;
      continue;
    }
    entry.translation = translated;
    entry.status = "translated";
    entry.warning = "";
    entry.languageConfirmed = true;
    entry.translationBlocked = false;
    applied += 1;
  }

  const remaining = getProjectStats(project).pending;
  if (!applied && !rejected) {
    throw new Error("元のlangと一致するキーがありませんでした。");
  }
  return { applied, rejected, remaining };
}

export function parseGlossary(text, targetLanguage = DEFAULT_TARGET_LANGUAGE) {
  const glossary = new Map(
    targetLanguage === DEFAULT_TARGET_LANGUAGE ? DEFAULT_GLOSSARY : [],
  );
  for (const rawLine of String(text || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const source = line.slice(0, separator).trim();
    const target = line.slice(separator + 1).trim();
    if (source && target) glossary.set(source, target);
  }
  return glossary;
}

function maskTokens(text) {
  const tokens = [];
  const masked = String(text).replace(TOKEN_PATTERN, (token) => {
    const index = tokens.push(token) - 1;
    return `\uE000BB${index}\uE001`;
  });
  return { masked, tokens };
}

function restoreTokens(text, tokens) {
  let restored = String(text);
  tokens.forEach((token, index) => {
    const marker = new RegExp(`\\uE000\\s*BB\\s*${index}\\s*\\uE001`, "gi");
    restored = restored.replace(marker, token);
  });
  return restored;
}

async function translateBySegments(translator, source) {
  const parts = String(source).split(new RegExp(`(${TOKEN_PATTERN.source})`, "gi"));
  const translated = [];
  for (const part of parts) {
    if (!part) continue;
    TOKEN_PATTERN.lastIndex = 0;
    if (TOKEN_PATTERN.test(part) || !TRANSLATABLE_TEXT_PATTERN.test(part)) {
      translated.push(part);
    } else {
      translated.push(await translator.translate(part));
    }
  }
  return translated.join("");
}

function applyGlossaryToResult(source, translated, glossary) {
  const exact = glossary.get(source);
  if (exact) return exact;
  let result = translated;
  for (const [sourceTerm, targetTerm] of glossary) {
    if (result.toLowerCase().includes(sourceTerm.toLowerCase())) {
      result = result.replace(new RegExp(escapeRegExp(sourceTerm), "gi"), targetTerm);
    }
  }
  return result;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export { getLocalTranslatorStatus };

export async function translateProject(
  project,
  {
    glossaryText = "",
    signal,
    onProgress = () => {},
    onDownloadProgress = () => {},
    translator: suppliedTranslator,
    translatorFactory = createLocalTranslator,
  } = {},
) {
  const targetLanguage = project.targetLanguage || DEFAULT_TARGET_LANGUAGE;
  for (const entry of project.entries) {
    ensureEntryLanguageMetadata(entry);
    if (
      !entry.translation.trim() &&
      !entry.translationBlocked &&
      entry.sourceLanguage === targetLanguage
    ) {
      entry.translation = entry.source;
      entry.status = "preserved";
    }
  }

  const glossary = parseGlossary(glossaryText, project.targetLanguage);
  const memory = new Map();
  for (const entry of project.entries) {
    if (entry.translation.trim()) {
      memory.set(`${entry.sourceLanguage || ""}\u0000${entry.source}`, entry.translation);
    }
  }
  const pending = project.entries.filter(
    (entry) =>
      !entry.ignored &&
      String(entry.source || "").trim() &&
      !entry.translation.trim() &&
      !entry.translationBlocked,
  );
  if (!pending.length) return getProjectStats(project);
  const sourceLanguages = [
    ...new Set(pending.map((entry) => entry.sourceLanguage).filter(Boolean)),
  ].filter((sourceLanguage) => sourceLanguage !== targetLanguage);
  const unsupportedLocales = [
    ...new Set(
      pending
        .filter((entry) => !entry.sourceLanguage)
        .map((entry) => entry.sourceLocale || "unknown"),
    ),
  ];
  if (unsupportedLocales.length) {
    throw new Error(`端末内翻訳に未対応の原文言語です: ${unsupportedLocales.join(", ")}`);
  }

  const pairKey = (from, to) => `${from}\u0000${to}`;
  const neededPairs = [];
  const addPair = (from, to) => {
    const key = pairKey(from, to);
    if (!neededPairs.some((pair) => pair.key === key)) {
      neededPairs.push({ key, from, to });
    }
  };
  for (const sourceLanguage of sourceLanguages) {
    if (sourceLanguage === "en") {
      addPair("en", targetLanguage);
    } else {
      addPair(sourceLanguage, "en");
      if (targetLanguage !== "en") addPair("en", targetLanguage);
    }
  }

  const translators = new Map();
  let completed = 0;

  try {
    if (suppliedTranslator) {
      translators.set("supplied", suppliedTranslator);
    } else {
      for (const [index, pair] of neededPairs.entries()) {
        const translator = await translatorFactory({
          sourceLanguage: pair.from,
          targetLanguage: pair.to,
          signal,
          onModelProgress(percent) {
            const aggregate =
              ((index + Math.max(0, Math.min(100, percent)) / 100) /
                Math.max(neededPairs.length, 1)) *
              100;
            onDownloadProgress(Math.round(aggregate));
          },
        });
        translators.set(pair.key, translator);
      }
    }

    for (const entry of pending) {
      if (signal?.aborted) throw new DOMException("翻訳を中止しました。", "AbortError");
      try {
        const memoryKey = `${entry.sourceLanguage || ""}\u0000${entry.source}`;
        let translated = memory.get(memoryKey);
        if (!translated) {
          const exactGlossary = glossary.get(entry.source);
          if (exactGlossary) {
            translated = exactGlossary;
          } else if (
            entry.sourceLanguage === targetLanguage ||
            !TRANSLATABLE_TEXT_PATTERN.test(entry.source)
          ) {
            translated = entry.source;
          } else {
            let translator = suppliedTranslator;
            if (!translator && entry.sourceLanguage === "en") {
              translator = translators.get(pairKey("en", targetLanguage));
            } else if (!translator) {
              const sourceToEnglish = translators.get(
                pairKey(entry.sourceLanguage, "en"),
              );
              if (targetLanguage === "en") {
                translator = sourceToEnglish;
              }
              const englishToTarget = translators.get(
                pairKey("en", targetLanguage),
              );
              if (!translator && sourceToEnglish && englishToTarget) {
                translator = {
                  async translate(text) {
                    return englishToTarget.translate(
                      await sourceToEnglish.translate(text),
                    );
                  },
                };
              }
            }
            if (!translator) {
              throw new Error(
                `翻訳経路を準備できませんでした: ${entry.sourceLanguage || entry.sourceLocale}`,
              );
            }
            const { masked, tokens } = maskTokens(entry.source);
            translated = restoreTokens(await translator.translate(masked), tokens);
            if (!placeholdersMatch(entry.source, translated)) {
              translated = await translateBySegments(translator, entry.source);
            }
            translated = applyGlossaryToResult(entry.source, translated, glossary);
          }
        }

        if (
          !translated.trim() ||
          translated.includes("\uFFFD") ||
          !placeholdersMatch(entry.source, translated)
        ) {
          if (translated.includes("\uFFFD")) {
            throw new Error("翻訳結果に不正な文字が含まれています");
          }
          throw new Error("プレースホルダーを安全に維持できませんでした");
        }
        memory.set(memoryKey, translated);
        entry.translation = translated;
        entry.status = "translated";
        entry.warning = "";
      } catch (error) {
        entry.warning = error.message || "翻訳に失敗しました";
      }
      completed += 1;
      onProgress({
        completed,
        total: pending.length,
        percent: pending.length ? Math.round((completed / pending.length) * 100) : 100,
        entry,
      });
    }
  } finally {
    if (!suppliedTranslator) {
      await Promise.allSettled(
        [...new Set(translators.values())]
          .filter((translator) => typeof translator.destroy === "function")
          .map((translator) => translator.destroy()),
      );
    }
  }

  return getProjectStats(project);
}

export function getMinecraftVersion(versionId) {
  return MINECRAFT_VERSIONS.find((version) => version.id === versionId) || MINECRAFT_VERSIONS.find((version) => version.id === "1.21");
}

export function buildPackMetadata(project, versionId = project.minecraftVersion) {
  const version = getMinecraftVersion(versionId);
  const language = getTargetLanguage(project.targetLanguage);
  const description = `${APP_NAME} | ${project.mod.name} ${project.mod.version} → ${language.nativeName}`;
  if (version.min) {
    return {
      pack: {
        description,
        min_format: version.min,
        max_format: version.max,
      },
    };
  }
  return {
    pack: {
      pack_format: version.format,
      description,
    },
  };
}

export function sanitizeFileName(value) {
  const cleaned = String(value || "")
    .normalize("NFKC")
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[_ .]+|[_ .]+$/g, "");
  return cleaned.slice(0, 120) || "Minecraft_MOD";
}

function buildTranslatedNamespace(project, namespace) {
  const entriesById = new Map(project.entries.map((entry) => [entry.id, entry]));
  const translated = { ...namespace.preserved };
  for (const id of namespace.entryIds) {
    const entry = entriesById.get(id);
    if (entry && shouldIncludeEntryInOutput(entry)) {
      translated[entry.key] = entry.translation;
    } else if (entry) {
      delete translated[entry.key];
    }
  }
  return translated;
}

function stringifyTranslatedNamespace(namespace, translated) {
  if (namespace.format === "factorio") {
    return stringifyFactorioLocale(translated);
  }
  if (namespace.format === "rimworld") {
    return stringifyRimWorldLanguageXml(translated);
  }
  return `${JSON.stringify(translated, null, 2)}\n`;
}

function archiveGenerationOptions(type) {
  return {
    type,
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
    platform: "UNIX",
  };
}

function fullModReadme(project, stats) {
  return [
    `${APP_NAME} browser edition`,
    `game=${SUPPORTED_GAMES[project.game].name}`,
    `mod=${project.mod.name}`,
    `target_locale=${project.targetLocale}`,
    `output_entries=${stats.output}`,
    `omitted_entries=${stats.omitted}`,
    `generated_at=${new Date().toISOString()}`,
    "privacy=Created entirely in this browser",
    "",
    "This archive is a translated copy of the selected mod.",
    "Back up and remove or disable the original copy before installing this one.",
    "Do not publish or redistribute this archive unless the original mod license or author permits it.",
    "",
    "このアーカイブは、選択したMODからブラウザ内で作成した翻訳済みコピーです。",
    "導入前に元のMODをバックアップし、元のコピーを削除または無効化してください。",
    "元MODのライセンスまたは作者が許可していない限り、このアーカイブを再配布しないでください。",
    "",
  ].join("\n");
}

function rimWorldPackageId(project) {
  const original = String(project.mod.id || "unknown.mod")
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, ".")
    .replace(/^\.+|\.+$/g, "") || "unknown.mod";
  const locale = String(project.targetLocale || "translation")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
  return `${original}.babelbreaker.${locale || "translation"}`;
}

function rimWorldTranslationRoot(project) {
  return `${sanitizeFileName(project.mod.name)}_${sanitizeFileName(project.targetLocale)}_Translation`;
}

function rimWorldAboutXml(project) {
  const language = getTargetLanguage(project.targetLanguage);
  const originalId = String(project.mod.id || "unknown.mod");
  const originalName = String(project.mod.name || "Unknown Mod");
  const translatedName = `${originalName} — ${language.nativeName} Translation`;
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    "<ModMetaData>",
    `  <name>${escapeXmlText(translatedName)}</name>`,
    "  <author>Babel Breaker user-generated</author>",
    `  <packageId>${escapeXmlText(rimWorldPackageId(project))}</packageId>`,
    `  <description>${escapeXmlText(`A ${language.nativeName} translation for ${originalName}, generated locally with Babel Breaker. The original mod is required.`)}</description>`,
    "  <modDependencies>",
    "    <li>",
    `      <packageId>${escapeXmlText(originalId)}</packageId>`,
    `      <displayName>${escapeXmlText(originalName)}</displayName>`,
    "    </li>",
    "  </modDependencies>",
    "  <loadAfter>",
    `    <li>${escapeXmlText(originalId)}</li>`,
    "  </loadAfter>",
    "</ModMetaData>",
    "",
  ].join("\n");
}

async function buildSingleGameArchive(project, outputType) {
  const stats = getProjectStats(project);
  const game = project.game;

  if (game === "factorio" || game === "stardew") {
    if (!project.sourceBytes) {
      throw new Error("元のMODアーカイブを再読み込みしてください。");
    }
    const zip = await JSZip.loadAsync(project.sourceBytes, { createFolders: false });
    for (const namespace of project.namespaces) {
      const translated = buildTranslatedNamespace(project, namespace);
      zip.file(
        namespace.outputPath,
        stringifyTranslatedNamespace(namespace, translated),
      );
    }
    for (const replacement of project.imageReplacements || []) {
      if (replacement.containerId === "root") zip.file(replacement.path, replacement.bytes);
    }
    const readmePath = `${project.mod.root || ""}_BABEL_BREAKER_README.txt`;
    zip.file(readmePath, fullModReadme(project, stats));
    const currentRoot = String(project.mod.root || "").replace(/\/$/, "");
    const desiredRoot = game === "factorio"
      ? `${sanitizeFileName(project.mod.id)}_${sanitizeFileName(project.mod.version)}`
      : currentRoot && !currentRoot.includes("/")
        ? currentRoot
        : sanitizeFileName(project.mod.id || project.mod.name);
    let nativeZip = zip;
    if (currentRoot !== desiredRoot) {
      nativeZip = new JSZip();
      for (const entry of Object.values(zip.files)) {
        if (entry.dir) continue;
        const relativePath = currentRoot && entry.name.startsWith(`${currentRoot}/`)
          ? entry.name.slice(currentRoot.length + 1)
          : entry.name;
        nativeZip.file(`${desiredRoot}/${relativePath}`, await entry.async("uint8array"));
      }
    }
    await assertNativeOutputLayout(nativeZip, {
      kind: game,
      label: project.fileName,
    });
    const archive = await nativeZip.generateAsync(
      archiveGenerationOptions(outputType),
    );
    const filename =
      game === "factorio"
        ? `${sanitizeFileName(project.mod.id)}_${sanitizeFileName(project.mod.version)}.zip`
        : `${sanitizeFileName(project.mod.name)}_${sanitizeFileName(project.targetLocale)}_translated.zip`;
    return { archive, filename };
  }

  if (game === "rimworld") {
    const zip = new JSZip();
    const root = rimWorldTranslationRoot(project);
    zip.file(`${root}/About/About.xml`, rimWorldAboutXml(project));
    for (const namespace of project.namespaces) {
      const relativePath = namespace.outputPath.match(
        /(?:^|\/)languages\/[^/]+\/(.+)$/i,
      )?.[1];
      if (!relativePath) continue;
      const translated = buildTranslatedNamespace(project, namespace);
      zip.file(
        `${root}/Languages/${project.targetLocale}/${relativePath}`,
        stringifyTranslatedNamespace(namespace, translated),
      );
    }
    zip.file(
      `${root}/README.txt`,
      [
        `${APP_NAME} browser edition`,
        `translation_for=${project.mod.name}`,
        `required_package_id=${project.mod.id}`,
        `target_locale=${project.targetLocale}`,
        `output_entries=${stats.output}`,
        `omitted_entries=${stats.omitted}`,
        `generated_at=${new Date().toISOString()}`,
        "privacy=Created entirely in this browser",
        "",
        "This is a standalone RimWorld translation mod. It does not contain the original mod.",
        "Extract it into RimWorld/Mods, enable both mods, and load this translation after the original.",
        "",
        "これは元MODを含まない、独立したRimWorld翻訳MODです。",
        "RimWorld/Modsへ展開し、元MODと翻訳MODの両方を有効にして、翻訳MODを元MODより後に読み込んでください。",
        "",
      ].join("\n"),
    );
    await assertNativeOutputLayout(zip, {
      kind: "rimworld",
      label: project.fileName,
    });
    const archive = await zip.generateAsync(
      archiveGenerationOptions(outputType),
    );
    return {
      archive,
      filename: `${root}.zip`,
    };
  }

  throw new Error(`未対応の出力形式です: ${game}`);
}

function applyBatchTranslations(project, sourceProject, sourceProjectIndex) {
  const bySourceEntry = new Map(
    project.entries
      .filter((entry) => entry.sourceProjectIndex === sourceProjectIndex)
      .map((entry) => [String(entry.sourceEntryId), entry]),
  );
  return {
    ...sourceProject,
    imageReplacements: (project.imageReplacements || [])
      .filter((replacement) => replacement.sourceProjectIndex === sourceProjectIndex)
      .map(({ sourceProjectIndex: _sourceProjectIndex, ...replacement }) => replacement),
    entries: sourceProject.entries.map((entry) => {
      const combined = bySourceEntry.get(String(entry.id));
      if (!combined) return { ...entry };
      return {
        ...entry,
        translation: combined.translation,
        status: combined.status,
        ignored: combined.ignored,
        warning: combined.warning,
      };
    }),
  };
}

async function buildGameBatchArchive(project, outputType) {
  if (!project.sourceProjects?.length) {
    throw new Error("一括出力には元のMODアーカイブが必要です。");
  }
  const zip = new JSZip();
  for (const [index, sourceProject] of project.sourceProjects.entries()) {
    const translatedProject = applyBatchTranslations(
      project,
      sourceProject,
      index,
    );
    const result = await buildSingleGameArchive(
      translatedProject,
      "uint8array",
    );
    zip.file(result.filename, result.archive);
  }
  zip.file(
    "_BABEL_BREAKER_README.txt",
    [
      `${APP_NAME} browser edition`,
      `game=${SUPPORTED_GAMES[project.game].name}`,
      `mods=${project.sourceProjects.length}`,
      `target_locale=${project.targetLocale}`,
      `generated_at=${new Date().toISOString()}`,
      "",
      "This bundle contains one ready-to-install archive for each selected mod.",
      "Read the installation guide on Babel Breaker before replacing or enabling mods.",
      "Do not redistribute translated copies of original mods without permission.",
      "",
      "選択したMODごとの導入用アーカイブをまとめています。",
      "MODの入れ替えや有効化の前に、Babel Breakerの導入ガイドを確認してください。",
      "元MODを含む翻訳済みコピーは、許可なく再配布しないでください。",
      "",
    ].join("\n"),
  );
  const archive = await zip.generateAsync(
    archiveGenerationOptions(outputType),
  );
  return {
    archive,
    filename: `${project.sourceProjects.length}-mods_${project.game}_${sanitizeFileName(project.targetLocale)}.zip`,
  };
}

async function buildArtifactBatchArchive(project, outputType) {
  const zip = new JSZip();
  for (const [index, sourceProject] of project.sourceProjects.entries()) {
    const translatedProject = applyBatchTranslations(project, sourceProject, index);
    const result = await buildResourcePack(
      translatedProject,
      translatedProject.minecraftVersion,
      "uint8array",
    );
    zip.file(result.filename, result.archive);
  }
  zip.file(
    "README.txt",
    "Each file keeps the installation format of its source. Follow the format guide shown by Babel Breaker.\n各ファイルは元の導入形式を維持しています。Babel Breakerの形式別ガイドに従って導入してください。\n",
  );
  return {
    archive: await zip.generateAsync(archiveGenerationOptions(outputType)),
    filename: `${project.sourceProjects.length}-files_${project.targetLanguage}_translations.zip`,
  };
}

export async function buildResourcePack(
  project,
  versionId = project.minecraftVersion,
  outputType = "blob",
  { bedrockTranslationMode = project.bedrockTranslationMode || "localized" } = {},
) {
  const stats = getProjectStats(project);
  const game = project.game || "minecraft";
  if (project.artifactBatch) {
    return buildArtifactBatchArchive(project, outputType);
  }
  if (project.artifactState && project.artifactType) {
    return buildArtifactArchive(project, {
      outputType,
      entriesById: new Map(project.entries.map((entry) => [entry.id, entry])),
      includeEntry: shouldIncludeEntryInOutput,
      archiveOptions: archiveGenerationOptions,
      resourcePackMetadata: buildPackMetadata(project, versionId),
      renderDocument: (document, entriesById, includeEntry) =>
        document.format === "java-region-nbt"
          ? renderJavaWorldRegionDocument(document, entriesById, includeEntry)
          : renderMinecraftContentDocument(document, entriesById, includeEntry),
      bedrockTranslationMode,
    });
  }
  if (game !== "minecraft") {
    return project.isBatch
      ? buildGameBatchArchive(project, outputType)
      : buildSingleGameArchive(project, outputType);
  }
  const version = getMinecraftVersion(versionId);
  const zip = new JSZip();
  const entriesById = new Map(project.entries.map((entry) => [entry.id, entry]));
  const instanceDocuments = [];
  let hasResourcePackContent = false;
  zip.file("pack.mcmeta", `${JSON.stringify(buildPackMetadata(project, versionId), null, 2)}\n`);

  for (const replacement of project.imageReplacements || []) {
    const path = replacement.path.replace(/^.*?(assets\/)/i, "$1");
    if (path.startsWith("assets/")) {
      zip.file(path, replacement.bytes);
      hasResourcePackContent = true;
    }
  }

  for (const namespace of project.namespaces) {
    if (namespace.contentDocument) {
      const contents = renderMinecraftContentDocument(
        namespace.contentDocument,
        entriesById,
        shouldIncludeEntryInOutput,
      );
      if (namespace.requiresInstanceInstall) {
        instanceDocuments.push({
          path:
            namespace.contentDocument.installPath ||
            namespace.contentDocument.outputPath,
          contents,
          kind: namespace.contentKind,
        });
      } else {
        zip.file(namespace.contentDocument.outputPath, contents);
        hasResourcePackContent = true;
      }
      continue;
    }
    const translated = { ...namespace.preserved };
    for (const id of namespace.entryIds) {
      const entry = entriesById.get(id);
      if (!entry) continue;
      if (shouldIncludeEntryInOutput(entry)) {
        translated[entry.key] = entry.translation;
      } else {
        delete translated[entry.key];
      }
    }
    const extension = version.legacyLang ? "lang" : "json";
    const contents = version.legacyLang
      ? stringifyLegacyLang(translated)
      : `${JSON.stringify(translated, null, 2)}\n`;
    zip.file(`assets/${namespace.namespace}/lang/${project.targetLocale}.${extension}`, contents);
    hasResourcePackContent = true;
  }

  zip.file(
    "_babel_breaker.txt",
    [
      `${APP_NAME} browser edition`,
      `mod=${project.mod.name}`,
      `mod_version=${project.mod.version}`,
      ...(project.mods?.length
        ? [`mods=${project.mods.map((mod) => `${mod.id}@${mod.version}`).join(",")}`]
        : []),
      `minecraft=${version.label}`,
      `source_locales=${project.namespaces
        .map((namespace) => `${namespace.namespace}:${namespace.sourceLocale}`)
        .join(",")}`,
      `target_locale=${project.targetLocale}`,
      `output_entries=${stats.output}`,
      `omitted_entries=${stats.omitted}`,
      `ignored_entries=${stats.ignored}`,
      `generated_at=${new Date().toISOString()}`,
      "privacy=Processed entirely in this browser",
      "",
    ].join("\n"),
  );

  const baseName = `${sanitizeFileName(project.mod.name)}_${sanitizeFileName(project.mod.version)}_${project.targetLocale}`;
  if (!instanceDocuments.length) {
    const archive = await zip.generateAsync(archiveGenerationOptions(outputType));
    return { archive, filename: `${baseName}.zip` };
  }

  const bundle = new JSZip();
  if (hasResourcePackContent) {
    const resourcePack = await zip.generateAsync(
      archiveGenerationOptions("uint8array"),
    );
    bundle.file(`${baseName}_resourcepack.zip`, resourcePack);
  }
  for (const document of instanceDocuments) {
    bundle.file(`instance/${document.path}`, document.contents);
  }
  bundle.file(
    "README.txt",
    [
      `${APP_NAME} Minecraft translation bundle`,
      `mod=${project.mod.name}`,
      `minecraft=${version.label}`,
      `target_locale=${project.targetLocale}`,
      `generated_at=${new Date().toISOString()}`,
      "",
      ...(hasResourcePackContent
        ? [
            `1. Copy ${baseName}_resourcepack.zip to the resourcepacks folder without extracting it.`,
            "2. Extract this bundle and copy the contents of the instance folder into the Minecraft instance root.",
          ]
        : [
            "1. Extract this bundle.",
            "2. Copy the contents of the instance folder into the Minecraft instance root.",
          ]),
      "3. Back up existing quest files before replacing them, then restart Minecraft or reload the quest data.",
      "",
      ...(hasResourcePackContent
        ? [
            `1. ${baseName}_resourcepack.zip は解凍せずresourcepacksフォルダへ入れてください。`,
            "2. このバンドルを展開し、instanceフォルダの中身をMinecraftインスタンスのルートへコピーしてください。",
          ]
        : [
            "1. このバンドルを展開してください。",
            "2. instanceフォルダの中身をMinecraftインスタンスのルートへコピーしてください。",
          ]),
      "3. 既存のクエストファイルをバックアップしてから置き換え、Minecraftを再起動するかクエストデータを再読込してください。",
      "",
    ].join("\n"),
  );
  const archive = await bundle.generateAsync(
    archiveGenerationOptions(outputType),
  );
  return { archive, filename: `${baseName}_translation_bundle.zip` };
}
