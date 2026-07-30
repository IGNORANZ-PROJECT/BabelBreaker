import JSZip from "jszip";
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

export const APP_NAME = "Babel Breaker";
export const TARGET_LOCALE = getTargetLanguage(DEFAULT_TARGET_LANGUAGE).minecraftLocale;
export const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;
export const MAX_ARCHIVE_ENTRIES = 100_000;
export const MAX_LANG_TEXT_LENGTH = 10 * 1024 * 1024;
export const MAX_TOTAL_LANG_BYTES = 64 * 1024 * 1024;
export const MAX_METADATA_TEXT_LENGTH = 2 * 1024 * 1024;
export const MAX_BATCH_FILES = 50;
export const MAX_BATCH_BYTES = 1024 * 1024 * 1024;

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
  /%(?:\d+\$)?[-#+ 0,(<]*\d*(?:\.\d+)?[tT]?[a-zA-Z%]|\{[0-9]+\}|§[0-9a-fk-or]|\\[ntr]|[\n\t\r]|https?:\/\/[^\s]+/gi;
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
  Object.assign(entry, classified, {
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

export async function analyzeArchive(
  file,
  { targetLanguage = DEFAULT_TARGET_LANGUAGE, targetLocale } = {},
) {
  const language = getTargetLanguage(targetLanguage);
  const resolvedTargetLocale = targetLocale || language.minecraftLocale;
  if (!file?.name || !/\.(jar|zip)$/i.test(file.name)) {
    throw new Error("Minecraft MODの .jar または .zip を選択してください。");
  }
  if (Number(file.size || 0) > MAX_ARCHIVE_BYTES) {
    throw new Error("512MBを超えるファイルには対応していません。");
  }

  let zip;
  try {
    const archiveData = typeof file.arrayBuffer === "function" ? await file.arrayBuffer() : file;
    zip = await JSZip.loadAsync(archiveData, { createFolders: false });
  } catch (error) {
    throw new Error(`JARを開けませんでした。破損していないか確認してください。 (${error.message})`);
  }

  const archiveEntries = Object.values(zip.files);
  if (archiveEntries.length > MAX_ARCHIVE_ENTRIES) {
    throw new Error("JAR内のファイル数が多すぎます。");
  }
  archiveEntries.forEach(assertSafeArchivePath);

  const langEntries = archiveEntries.filter(
    (entry) => !entry.dir && /^assets\/[^/]+\/lang\/[^/]+\.(json|lang)$/i.test(entry.name),
  );
  if (!langEntries.length) {
    throw new Error("langファイルが見つかりません。assets/<modid>/lang/ を確認してください。");
  }

  const declaredLangBytes = langEntries.reduce(
    (total, entry) => total + (getDeclaredUncompressedSize(entry) || 0),
    0,
  );
  if (declaredLangBytes > MAX_TOTAL_LANG_BYTES) {
    throw new Error("langファイルの展開後サイズが大きすぎます。");
  }

  const warnings = [];
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
  if (!sources.length) {
    throw new Error("読み込めるlangファイルがありませんでした。");
  }

  const grouped = new Map();
  for (const source of sources) {
    if (!grouped.has(source.namespace)) grouped.set(source.namespace, []);
    grouped.get(source.namespace).push(source);
  }
  const mod = await detectModMetadata(archiveEntries, file.name, [...grouped.keys()]);
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
    createdAt: new Date().toISOString(),
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

  const targetLanguage = validProjects[0].targetLanguage;
  const targetLocale = validProjects[0].targetLocale;
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

  for (const project of validProjects) {
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
        const collisionKey = `${namespace.namespace}\u0000${sourceEntry.key}`;
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
        };
        entries.push(entry);
        entryMap.set(collisionKey, entry);
        combinedNamespace.entryIds.push(id);
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
    MINECRAFT_VERSIONS[Math.min(...versionIndexes)]?.id ||
    validProjects[0].minecraftVersion;
  const loaders = [...new Set(validProjects.map((project) => project.mod.loader))];

  return {
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
    namespaces: project.namespaces.length,
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
    "The following is Minecraft mod language JSON.",
    "The source language was detected from each Minecraft language filename:",
    ...sourceLines,
    `Translate only the values into ${target.englishName} (${target.nativeName}). Never change a key.`,
    "Use each namespace's detected source language. Use concise, natural wording suitable for short in-game UI text.",
    "Preserve every formatting token exactly, including %s, %1$d, {0}, §a, line breaks, and URLs.",
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
      addPair("en", targetLanguage);
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
              const englishToTarget = translators.get(
                pairKey("en", targetLanguage),
              );
              if (sourceToEnglish && englishToTarget) {
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

export async function buildResourcePack(project, versionId = project.minecraftVersion, outputType = "blob") {
  const stats = getProjectStats(project);
  const version = getMinecraftVersion(versionId);
  const zip = new JSZip();
  const entriesById = new Map(project.entries.map((entry) => [entry.id, entry]));
  zip.file("pack.mcmeta", `${JSON.stringify(buildPackMetadata(project, versionId), null, 2)}\n`);

  for (const namespace of project.namespaces) {
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

  const archive = await zip.generateAsync({
    type: outputType,
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
    platform: "UNIX",
  });
  const filename = `${sanitizeFileName(project.mod.name)}_${sanitizeFileName(project.mod.version)}_${project.targetLocale}.zip`;
  return { archive, filename };
}
