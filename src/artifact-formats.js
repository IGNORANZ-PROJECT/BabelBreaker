import JSZip from "jszip";

export const ARTIFACT_TYPES = {
  modpack: { id: "modpack", edition: "java", label: "MOD Pack" },
  java_world: { id: "java_world", edition: "java", label: "Java World" },
  bedrock_addon: { id: "bedrock_addon", edition: "bedrock", label: "Bedrock Add-on" },
  bedrock_world: { id: "bedrock_world", edition: "bedrock", label: "Bedrock World" },
  resource_pack: { id: "resource_pack", edition: "java", label: "Resource Pack" },
  data_pack: { id: "data_pack", edition: "java", label: "Data Pack" },
  server_plugin: { id: "server_plugin", edition: "java", label: "Server Plugin" },
};

const ARCHIVE_EXTENSION = /\.(?:jar|zip|mrpack|mcpack|mcaddon|mcworld)$/i;
const NESTED_ARCHIVE_PATH = /(?:^|\/)(?:mods\/[^/]+\.jar|resourcepacks\/[^/]+\.zip|(?:resource_packs|behavior_packs)\/[^/]+\.(?:zip|mcpack)|datapacks\/[^/]+\.zip|resources\.zip|[^/]+\.mcpack)$/i;
const SOURCE_LOCALES = new Set(["en", "en_us", "en_gb", "default"]);
const TEXT_FIELD_NAMES = new Set([
  "text", "title", "subtitle", "description", "name", "lore", "message",
  "npc_name",
]);

function normalizedNames(entries) {
  return entries.filter((entry) => !entry.dir).map((entry) => entry.name.replaceAll("\\", "/"));
}

function markerPrefix(path, marker) {
  const index = path.toLowerCase().lastIndexOf(marker.toLowerCase());
  return index < 0 ? "" : path.slice(0, index);
}

function commonMarker(names, pattern) {
  return names.find((name) => pattern.test(name)) || "";
}

async function readJson(entry) {
  try {
    return JSON.parse(await entry.async("string"));
  } catch {
    return null;
  }
}

export async function detectArtifactType(zip, fileName = "") {
  const entries = Object.values(zip.files);
  const names = normalizedNames(entries);
  const lowerName = String(fileName).toLowerCase();

  const modrinthPath = commonMarker(names, /(^|\/)modrinth\.index\.json$/i);
  if (modrinthPath) {
    return { ...ARTIFACT_TYPES.modpack, variant: "modrinth", confidence: "high", rootPrefix: markerPrefix(modrinthPath, "modrinth.index.json") };
  }

  const manifestPath = commonMarker(names, /(^|\/)manifest\.json$/i);
  let manifest = null;
  if (manifestPath) {
    manifest = await readJson(zip.file(manifestPath));
    if (manifest?.manifestType === "minecraftModpack" || manifest?.minecraft?.modLoaders) {
      return { ...ARTIFACT_TYPES.modpack, variant: "curseforge", confidence: "high", rootPrefix: markerPrefix(manifestPath, "manifest.json") };
    }
  }

  const levelPath = commonMarker(names, /(^|\/)level\.dat$/i);
  if (levelPath) {
    const rootPrefix = markerPrefix(levelPath, "level.dat");
    const hasBedrockDatabase = names.some((name) => name.startsWith(`${rootPrefix}db/`));
    return {
      ...(hasBedrockDatabase ? ARTIFACT_TYPES.bedrock_world : ARTIFACT_TYPES.java_world),
      variant: hasBedrockDatabase ? "mcworld" : "world-zip",
      confidence: "high",
      rootPrefix,
    };
  }

  if (manifestPath) {
    const moduleTypes = new Set((manifest?.modules || []).map((module) => module?.type));
    if ([...moduleTypes].some((type) => ["resources", "data", "script", "world_template"].includes(type))) {
      const variant = moduleTypes.has("resources") && !moduleTypes.has("data") && !moduleTypes.has("script")
        ? "bedrock-resource-pack"
        : "bedrock-addon";
      return {
        ...(variant === "bedrock-resource-pack"
          ? { ...ARTIFACT_TYPES.resource_pack, edition: "bedrock" }
          : ARTIFACT_TYPES.bedrock_addon),
        variant,
        confidence: "high",
        rootPrefix: markerPrefix(manifestPath, "manifest.json"),
      };
    }
  }

  const packPath = commonMarker(names, /(^|\/)pack\.mcmeta$/i);
  if (packPath) {
    const rootPrefix = markerPrefix(packPath, "pack.mcmeta");
    const hasAssets = names.some((name) => name.startsWith(`${rootPrefix}assets/`));
    const hasData = names.some((name) => name.startsWith(`${rootPrefix}data/`));
    if (hasAssets && !hasData) return { ...ARTIFACT_TYPES.resource_pack, variant: "java", confidence: "high", rootPrefix };
    if (hasData) return { ...ARTIFACT_TYPES.data_pack, variant: hasAssets ? "combined" : "java", confidence: "high", rootPrefix };
  }

  const pluginPath = commonMarker(names, /(^|\/)(?:plugin|paper-plugin|bungee)\.yml$/i)
    || commonMarker(names, /(^|\/)velocity-plugin\.json$/i);
  if (pluginPath) {
    return { ...ARTIFACT_TYPES.server_plugin, variant: "plugin-archive", confidence: "high", rootPrefix: markerPrefix(pluginPath, pluginPath.split("/").pop()) };
  }

  if (/\.mcaddon$/i.test(lowerName) || names.some((name) => /\.mcpack$/i.test(name))) {
    return { ...ARTIFACT_TYPES.bedrock_addon, variant: "mcaddon", confidence: "high", rootPrefix: "" };
  }
  if (/\.mcworld$/i.test(lowerName)) {
    return { ...ARTIFACT_TYPES.bedrock_world, variant: "mcworld", confidence: "medium", rootPrefix: "" };
  }
  if (names.some((name) => /(^|\/)mods\/[^/]+\.jar$/i.test(name))) {
    return { ...ARTIFACT_TYPES.modpack, variant: "instance", confidence: "medium", rootPrefix: "" };
  }
  return null;
}

function safePath(name) {
  const normalized = String(name).replaceAll("\\", "/");
  if (!normalized || normalized.includes("\0") || normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized)) return false;
  return !normalized.split("/").some((part) => part === "..");
}

function validateContainerEntries(entries, maxEntries, maxExpandedBytes) {
  if (entries.length > maxEntries) throw new Error("アーカイブ内のファイル数が多すぎます。");
  const seen = new Set();
  let expandedBytes = 0;
  for (const entry of entries) {
    if (!safePath(entry.name)) throw new Error(`安全でないファイルパスです: ${entry.name}`);
    const normalized = entry.name.replaceAll("\\", "/");
    if (seen.has(normalized)) throw new Error(`重複するファイルパスです: ${entry.name}`);
    seen.add(normalized);
    const uncompressed = Number(entry?._data?.uncompressedSize || 0);
    const compressed = Number(entry?._data?.compressedSize || 0);
    expandedBytes += uncompressed;
    if (uncompressed > 10 * 1024 * 1024 && compressed > 0 && uncompressed / compressed > 250) {
      throw new Error(`圧縮率が高すぎるファイルです: ${entry.name}`);
    }
  }
  if (expandedBytes > maxExpandedBytes) throw new Error("アーカイブの展開後サイズが大きすぎます。");
}

async function bedrockPackRootPrefix(zip) {
  const manifests = Object.values(zip.files).filter(
    (entry) => !entry.dir && /(^|\/)manifest\.json$/i.test(entry.name),
  );
  for (const entry of manifests) {
    const manifest = await readJson(entry);
    const moduleTypes = new Set(
      (Array.isArray(manifest?.modules) ? manifest.modules : [])
        .map((module) => module?.type),
    );
    if (["resources", "data", "script", "world_template"].some((type) => moduleTypes.has(type))) {
      return entry.name.slice(0, -"manifest.json".length);
    }
  }
  return null;
}

async function collectContainers(rootZip, detection, maxEntries, maxExpandedBytes) {
  const containers = [{ id: "root", parentId: null, entryPath: "", zip: rootZip }];
  const rootEntries = Object.values(rootZip.files);
  validateContainerEntries(rootEntries, maxEntries, maxExpandedBytes);
  const allowNested = ["modpack", "java_world", "bedrock_addon", "bedrock_world"].includes(detection.id);
  if (!allowNested) return containers;

  for (const entry of rootEntries) {
    if (entry.dir) continue;
    const knownNestedArchive = NESTED_ARCHIVE_PATH.test(entry.name);
    const bedrockZipCandidate = detection.id === "bedrock_addon" && /(?:^|\/)[^/]+\.zip$/i.test(entry.name);
    if (!knownNestedArchive && !bedrockZipCandidate) continue;
    let bytes;
    let zip;
    try {
      bytes = await entry.async("uint8array");
      zip = await JSZip.loadAsync(bytes, { createFolders: false });
    } catch {
      // A file with an archive extension is not necessarily a ZIP. Keep it untouched.
      continue;
    }
    const entries = Object.values(zip.files);
    validateContainerEntries(entries, maxEntries, maxExpandedBytes);
    const nestedBedrockRoot = detection.id === "bedrock_addon"
      ? await bedrockPackRootPrefix(zip)
      : null;
    if (!knownNestedArchive && nestedBedrockRoot === null) continue;
    containers.push({
      id: `nested:${entry.name}`,
      parentId: "root",
      entryPath: entry.name,
      zip,
      sourceBytes: bytes,
      rootPrefix: nestedBedrockRoot || "",
    });
  }
  return containers;
}

function parseKeyValue(text) {
  const result = {};
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith("!")) continue;
    const separator = line.search(/[:=]/);
    if (separator < 1) continue;
    result[line.slice(0, separator).trim()] = line.slice(separator + 1);
  }
  return result;
}

function stringifyKeyValue(data) {
  return `${Object.entries(data).map(([key, value]) => `${key}=${String(value).replace(/\r?\n/g, "\\n")}`).join("\n")}\n`;
}

function parseBedrockLang(text) {
  const raw = String(text);
  const newline = raw.includes("\r\n") ? "\r\n" : "\n";
  const lines = raw.split(/\r?\n/);
  const data = {};
  const records = [];
  lines.forEach((line, index) => {
    if (!line.trim() || /^\s*#/.test(line)) return;
    const separator = line.indexOf("=");
    if (separator < 1) return;
    const key = line.slice(0, separator).trim();
    const rawValue = line.slice(separator + 1);
    const commentIndex = rawValue.search(/\s+###/);
    const source = commentIndex >= 0 ? rawValue.slice(0, commentIndex) : rawValue;
    const suffix = commentIndex >= 0 ? rawValue.slice(commentIndex) : "";
    data[key] = source;
    records.push({ key, source, line: index, prefix: `${line.slice(0, separator + 1)}`, suffix });
  });
  return { lines, data, records, newline };
}

function flattenJsonText(value, path = [], records = []) {
  if (Array.isArray(value)) {
    value.forEach((child, index) => flattenJsonText(child, [...path, index], records));
    return records;
  }
  if (!value || typeof value !== "object") return records;
  for (const [key, child] of Object.entries(value)) {
    const nextPath = [...path, key];
    if (typeof child === "string" && TEXT_FIELD_NAMES.has(key) && /\p{L}/u.test(child)) {
      records.push({ key: nextPath.join("."), source: child, path: nextPath });
    } else {
      flattenJsonText(child, nextPath, records);
    }
  }
  return records;
}

function setAtPath(root, path, value) {
  let current = root;
  for (let index = 0; index < path.length - 1; index += 1) current = current[path[index]];
  current[path.at(-1)] = value;
}

function localeFromPath(path) {
  return path.match(/(?:^|\/)([a-z]{2}(?:[_-][a-z]{2})?|default)\.(?:json|lang|properties|ya?ml|toml)$/i)?.[1]?.toLowerCase() || null;
}

function targetPathForLocale(path, targetLocale) {
  return path.replace(/([a-z]{2}(?:[_-][a-z]{2})?|default)(\.(?:json|lang|properties|ya?ml|toml))$/i, `${targetLocale}$2`);
}

function pluginCandidate(path) {
  return /(?:^|\/)(?:lang|locale|locales|messages|translations|i18n)\//i.test(path)
    && /\.(?:json|properties|ya?ml|toml)$/i.test(path);
}

function pluginMessageBundle(path) {
  const match = path.match(/^(.*\/)?(messages)(?:_([a-z]{2}(?:_[a-z]{2})?))?\.properties$/i);
  if (!match) return null;
  return {
    prefix: match[1] || "",
    stem: match[2],
    locale: match[3]?.toLowerCase() || "default",
  };
}

function localeLanguage(locale) {
  return String(locale || "").split(/[_-]/)[0].toLowerCase();
}

async function bedrockLocalizationEvidence(zip, prefix, candidates, readText) {
  const localeFiles = [...new Set(
    candidates.map((candidate) => String(candidate.locale || "").toLowerCase()),
  )];
  const languagesPath = `${prefix}languages.json`.toLowerCase();
  const languagesEntry = Object.values(zip.files).find(
    (entry) => !entry.dir && entry.name.replaceAll("\\", "/").toLowerCase() === languagesPath,
  );
  let languagesJson = languagesEntry ? "invalid" : "missing";
  let declaredLocales = [];
  if (languagesEntry) {
    try {
      const parsed = JSON.parse(await readText(languagesEntry, languagesEntry.name));
      if (Array.isArray(parsed) && parsed.every((locale) => typeof locale === "string")) {
        languagesJson = "valid";
        declaredLocales = [...new Set(parsed.map((locale) => locale.toLowerCase()))];
      }
    } catch {
      // Keep invalid so the UI can explain that compatibility is uncertain.
    }
  }
  const declaresKnownLocale = declaredLocales.some((locale) => localeFiles.includes(locale));
  return {
    confirmed: localeFiles.length > 1 || declaresKnownLocale,
    languageFileCount: localeFiles.length,
    languagesJson,
    declaredLocales,
  };
}

function parsePluginScalarLines(text) {
  const records = [];
  const lines = String(text).split(/\r?\n/);
  lines.forEach((line, index) => {
    if (!line.trim() || /^\s*[#!]/.test(line)) return;
    const match = line.match(/^(\s*[A-Za-z0-9_.-]+\s*[:=]\s*)(["']?)(.*?)(\2)(\s*(?:#.*)?)$/);
    if (!match || !/\p{L}/u.test(match[3])) return;
    const key = line.match(/^\s*([A-Za-z0-9_.-]+)\s*[:=]/)?.[1] || `line.${index + 1}`;
    records.push({ key, source: match[3], line: index, prefix: match[1] + match[2], suffix: match[4] + match[5] });
  });
  return { lines, records };
}

function parseFunctionText(text) {
  const lines = String(text).split(/\r?\n/);
  const records = [];
  const allowedCommand = /^\s*(?:execute\s+.*?\s+run\s+)?(?:tellraw|titleraw|title|bossbar\s+set\s+\S+\s+name|team\s+modify\s+\S+\s+(?:displayName|prefix|suffix)|scoreboard\s+objectives\s+add)\b/i;
  lines.forEach((line, lineIndex) => {
    if (!allowedCommand.test(line)) return;
    const pattern = /(["']?text["']?\s*:\s*)(["'])(.*?)(\2)/g;
    let index = 0;
    for (const match of line.matchAll(pattern)) {
      const source = match[3].replace(/\\([\\"'])/g, "$1");
      if (!/\p{L}/u.test(source)) continue;
      const valueStart = match.index + match[1].length + 1;
      records.push({ key: `line.${lineIndex + 1}.text.${++index}`, source, line: lineIndex, start: valueStart, end: valueStart + match[3].length, quote: match[2] });
    }
  });
  return { lines, records };
}

export async function analyzeArtifactDocuments(rootZip, detection, {
  targetLocale,
  maxEntries = 100_000,
  maxExpandedBytes = 2 * 1024 * 1024 * 1024,
  readText,
} = {}) {
  const containers = await collectContainers(rootZip, detection, maxEntries, maxExpandedBytes);
  const documents = [];
  const warnings = [];
  let referencedFiles = 0;

  if (detection.variant === "modrinth") {
    const indexEntry = rootZip.file(`${detection.rootPrefix || ""}modrinth.index.json`);
    const index = indexEntry ? await readJson(indexEntry) : null;
    referencedFiles = Array.isArray(index?.files) ? index.files.length : 0;
  } else if (detection.variant === "curseforge") {
    const entry = rootZip.file(`${detection.rootPrefix || ""}manifest.json`);
    const manifest = entry ? await readJson(entry) : null;
    referencedFiles = Array.isArray(manifest?.files) ? manifest.files.length : 0;
  }

  for (const container of containers) {
    const entries = Object.values(container.zip.files).filter((entry) => !entry.dir);
    const javaGroups = new Map();
    const bedrockGroups = new Map();
    const pluginBundleGroups = new Map();

    for (const entry of entries) {
      const path = entry.name.replaceAll("\\", "/");
      const javaMatch = path.match(/^(.*?assets\/)([a-z0-9_.-]+)\/lang\/([^/]+)\.(json|lang)$/i);
      if (javaMatch) {
        const groupId = `${container.id}:${javaMatch[1]}${javaMatch[2]}`;
        if (!javaGroups.has(groupId)) javaGroups.set(groupId, []);
        try {
          const text = await readText(entry, path);
          const data = javaMatch[4].toLowerCase() === "json" ? JSON.parse(text) : parseKeyValue(text);
          javaGroups.get(groupId).push({ path, locale: javaMatch[3].toLowerCase(), ext: javaMatch[4].toLowerCase(), data, namespace: javaMatch[2], prefix: javaMatch[1] });
        } catch (error) {
          warnings.push(`${path}: ${error.message}`);
        }
        continue;
      }

      const bedrockMatch = path.match(/^(.*?texts\/)([^/]+)\.lang$/i);
      if (bedrockMatch) {
        const groupId = `${container.id}:${bedrockMatch[1]}`;
        if (!bedrockGroups.has(groupId)) bedrockGroups.set(groupId, []);
        try {
          const parsed = parseBedrockLang(await readText(entry, path));
          bedrockGroups.get(groupId).push({
            path,
            prefix: bedrockMatch[1],
            locale: bedrockMatch[2].toLowerCase(),
            ...parsed,
          });
        } catch (error) {
          warnings.push(`${path}: ${error.message}`);
        }
        continue;
      }

      if (["data_pack", "java_world", "modpack"].includes(detection.id) && /(?:^|\/)data\/[^/]+\/(?:advancements?|dialog|enchantment|jukebox_song)\/.+\.json$/i.test(path)) {
        try {
          const json = JSON.parse(await readText(entry, path));
          const records = flattenJsonText(json);
          if (records.length) documents.push({ id: `${container.id}:${path}`, containerId: container.id, format: "structured-json", sourcePath: path, outputPath: path, sourceLocale: "en_us", namespace: path, data: json, records });
        } catch (error) {
          warnings.push(`${path}: ${error.message}`);
        }
        continue;
      }

      const supportsFunctions = ["data_pack", "java_world", "modpack", "bedrock_addon", "bedrock_world"].includes(detection.id);
      const functionPath = detection.edition === "bedrock"
        ? /(?:^|\/)functions\/.+\.mcfunction$/i.test(path)
        : /(?:^|\/)data\/[^/]+\/functions?\/.+\.mcfunction$/i.test(path);
      if (supportsFunctions && functionPath) {
        try {
          const parsed = parseFunctionText(await readText(entry, path));
          if (parsed.records.length) documents.push({ id: `${container.id}:${path}`, containerId: container.id, format: "function-text", sourcePath: path, outputPath: path, sourceLocale: "en_us", namespace: path, data: parsed.lines, records: parsed.records });
        } catch (error) {
          warnings.push(`${path}: ${error.message}`);
        }
        continue;
      }

      if (["bedrock_addon", "bedrock_world"].includes(detection.id) && /(?:^|\/)dialogue\/.+\.json$/i.test(path)) {
        try {
          const json = JSON.parse(await readText(entry, path));
          const records = flattenJsonText(json);
          if (records.length) documents.push({ id: `${container.id}:${path}`, containerId: container.id, format: "structured-json", sourcePath: path, outputPath: path, sourceLocale: "en_us", namespace: path, data: json, records });
        } catch (error) {
          warnings.push(`${path}: ${error.message}`);
        }
        continue;
      }

      const messageBundle = detection.id === "server_plugin"
        ? pluginMessageBundle(path)
        : null;
      if (messageBundle) {
        const groupId = `${container.id}:${messageBundle.prefix}${messageBundle.stem}`;
        if (!pluginBundleGroups.has(groupId)) pluginBundleGroups.set(groupId, []);
        try {
          pluginBundleGroups.get(groupId).push({
            ...messageBundle,
            path,
            parsed: parsePluginScalarLines(await readText(entry, path)),
          });
        } catch (error) {
          warnings.push(`${path}: ${error.message}`);
        }
        continue;
      }

      if (detection.id === "server_plugin" && pluginCandidate(path)) {
        const locale = localeFromPath(path);
        if (locale && !SOURCE_LOCALES.has(locale)) continue;
        try {
          const text = await readText(entry, path);
          if (/\.json$/i.test(path)) {
            const data = JSON.parse(text);
            const records = Object.entries(data).filter(([, value]) => typeof value === "string" && /\p{L}/u.test(value)).map(([key, source]) => ({ key, source, path: [key] }));
            if (records.length) documents.push({ id: `${container.id}:${path}`, containerId: container.id, format: "plugin-json", sourcePath: path, outputPath: locale ? targetPathForLocale(path, targetLocale) : path, sourceLocale: locale || "en_us", namespace: path, data, records });
          } else {
            const parsed = parsePluginScalarLines(text);
            if (parsed.records.length) documents.push({ id: `${container.id}:${path}`, containerId: container.id, format: "plugin-lines", sourcePath: path, outputPath: locale ? targetPathForLocale(path, targetLocale) : path, sourceLocale: locale || "en_us", namespace: path, data: parsed.lines, records: parsed.records });
          }
        } catch (error) {
          warnings.push(`${path}: ${error.message}`);
        }
      }
    }

    for (const candidates of javaGroups.values()) {
      const source = candidates.find((candidate) => candidate.locale === "en_us") || candidates.find((candidate) => candidate.locale === "en_gb") || candidates.find((candidate) => candidate.locale !== targetLocale) || candidates[0];
      const existing = candidates.find((candidate) => candidate.locale === targetLocale);
      documents.push({
        id: `${container.id}:${source.prefix}${source.namespace}`,
        containerId: container.id,
        format: source.ext === "json" ? "java-json-lang" : "java-legacy-lang",
        sourcePath: source.path,
        outputPath: `${source.prefix}${source.namespace}/lang/${targetLocale}.${source.ext}`,
        sourceLocale: source.locale,
        namespace: source.namespace,
        data: source.data,
        preserved: existing?.data || {},
        records: Object.entries(source.data).map(([key, value]) => ({ key, source: String(value), existingTarget: existing?.data?.[key] })),
      });
    }

    for (const candidates of bedrockGroups.values()) {
      const normalizedTargetLocale = String(targetLocale).toLowerCase();
      const source = candidates.find((candidate) => candidate.locale === "en_us") || candidates.find((candidate) => candidate.locale !== normalizedTargetLocale) || candidates[0];
      const existing = candidates.find((candidate) => candidate.locale === normalizedTargetLocale);
      const localizationEvidence = await bedrockLocalizationEvidence(
        container.zip,
        source.prefix,
        candidates,
        readText,
      );
      documents.push({
        id: `${container.id}:${source.prefix}`,
        containerId: container.id,
        format: "bedrock-lang",
        sourcePath: source.path,
        outputPath: `${source.prefix}${targetLocale}.lang`,
        sourceLocale: source.locale,
        namespace: source.prefix.replace(/\/?texts\/$/i, "") || "Bedrock Pack",
        data: source.lines,
        newline: source.newline,
        preserved: existing?.data || {},
        localizationEvidence,
        records: source.records.map((record) => ({ ...record, existingTarget: existing?.data?.[record.key] })),
      });
    }

    for (const candidates of pluginBundleGroups.values()) {
      const source = candidates.find((candidate) => candidate.locale === "en_us")
        || candidates.find((candidate) => candidate.locale === "en_gb")
        || candidates.find((candidate) => candidate.locale === "en")
        || candidates.find((candidate) => candidate.locale === "default")
        || candidates[0];
      const targetLanguage = localeLanguage(targetLocale);
      const existing = candidates.find((candidate) => candidate.locale === String(targetLocale).toLowerCase())
        || candidates.find((candidate) => localeLanguage(candidate.locale) === targetLanguage);
      const existingByKey = new Map(
        (existing?.parsed.records || []).map((record) => [record.key, record.source]),
      );
      documents.push({
        id: `${container.id}:${source.prefix}${source.stem}`,
        containerId: container.id,
        format: "plugin-lines",
        sourcePath: source.path,
        outputPath: existing?.path || `${source.prefix}${source.stem}_${targetLanguage}.properties`,
        sourceLocale: source.locale === "default" ? "en_us" : source.locale,
        namespace: source.path,
        data: source.parsed.lines,
        records: source.parsed.records.map((record) => ({
          ...record,
          existingTarget: existingByKey.get(record.key),
        })),
      });
    }
  }

  return { containers, documents, warnings, referencedFiles };
}

export function renderArtifactDocument(
  document,
  entriesById,
  includeEntry,
  { preserveUntranslated = false } = {},
) {
  if (["java-json-lang", "java-legacy-lang"].includes(document.format)) {
    const data = { ...(document.preserved || {}) };
    for (const record of document.records) {
      const entry = entriesById.get(record.entryId);
      if (entry && includeEntry(entry)) data[record.key] = entry.translation;
    }
    return document.format === "java-json-lang" ? `${JSON.stringify(data, null, 2)}\n` : stringifyKeyValue(data);
  }
  if (document.format === "bedrock-lang") {
    const lines = [...document.data];
    for (const record of document.records) {
      const entry = entriesById.get(record.entryId);
      if (entry && includeEntry(entry)) {
        lines[record.line] = `${record.prefix}${entry.translation}${record.suffix}`;
      } else if (!preserveUntranslated) {
        lines[record.line] = "";
      }
    }
    const newline = document.newline || "\n";
    return `${lines.join(newline)}${newline}`;
  }
  if (["structured-json", "plugin-json"].includes(document.format)) {
    const data = structuredClone(document.data);
    for (const record of document.records) {
      const entry = entriesById.get(record.entryId);
      if (entry && includeEntry(entry)) setAtPath(data, record.path, entry.translation);
    }
    return `${JSON.stringify(data, null, 2)}\n`;
  }
  if (document.format === "plugin-lines") {
    const lines = [...document.data];
    for (const record of document.records) {
      const entry = entriesById.get(record.entryId);
      if (entry && includeEntry(entry)) lines[record.line] = `${record.prefix}${entry.translation}${record.suffix}`;
    }
    return `${lines.join("\n")}\n`;
  }
  if (document.format === "function-text") {
    const lines = [...document.data];
    const byLine = new Map();
    for (const record of document.records) {
      const entry = entriesById.get(record.entryId);
      if (!entry || !includeEntry(entry)) continue;
      if (!byLine.has(record.line)) byLine.set(record.line, []);
      byLine.get(record.line).push({ ...record, translation: entry.translation });
    }
    for (const [lineIndex, replacements] of byLine) {
      let line = lines[lineIndex];
      for (const replacement of replacements.sort((left, right) => right.start - left.start)) {
        const escaped = replacement.translation
          .replaceAll("\\", "\\\\")
          .replaceAll(replacement.quote, `\\${replacement.quote}`);
        line = `${line.slice(0, replacement.start)}${escaped}${line.slice(replacement.end)}`;
      }
      lines[lineIndex] = line;
    }
    return `${lines.join("\n")}\n`;
  }
  throw new Error(`未対応の文書形式です: ${document.format}`);
}

function manifestEntries(zip) {
  return Object.values(zip.files).filter((entry) => !entry.dir && /(^|\/)manifest\.json$/i.test(entry.name));
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function nearestManifestPath(zip, documentPath) {
  return manifestEntries(zip)
    .map((entry) => entry.name)
    .filter((path) => documentPath.startsWith(path.slice(0, -"manifest.json".length)))
    .sort((left, right) => right.length - left.length)[0] || "";
}

async function prepareBedrockVersionPlan(project, rootZip) {
  if (project.artifactType === "bedrock_world" || project.edition !== "bedrock") return null;
  const containers = [{ id: "root", zip: rootZip }];
  for (const container of project.artifactState.containers.filter((item) => item.parentId === "root")) {
    try {
      containers.push({ id: container.id, zip: await JSZip.loadAsync(container.sourceBytes, { createFolders: false }) });
    } catch {
      // Invalid nested packs are preserved without manifest changes.
    }
  }
  const records = [];
  for (const container of containers) {
    for (const entry of manifestEntries(container.zip)) {
      const manifest = await readJson(entry);
      if (!manifest || typeof manifest !== "object") continue;
      records.push({
        key: `${container.id}:${entry.name}`,
        containerId: container.id,
        path: entry.name,
        manifest,
        uuid: manifest.header?.uuid || "",
        version: Array.isArray(manifest.header?.version) ? manifest.header.version.map(Number) : null,
      });
    }
  }

  const changed = new Set();
  for (const document of project.documents || []) {
    const container = containers.find((item) => item.id === document.containerId);
    if (!container) continue;
    const path = nearestManifestPath(container.zip, document.outputPath);
    if (path) changed.add(`${container.id}:${path}`);
  }

  const versions = new Map();
  const ensureVersion = (record) => {
    if (!record?.uuid || !record.version || record.version.length < 3) return false;
    if (!versions.has(record.uuid)) {
      const next = [...record.version];
      next[2] = Number.isFinite(next[2]) ? next[2] + 1 : 1;
      versions.set(record.uuid, next);
    }
    return true;
  };
  records.filter((record) => changed.has(record.key)).forEach(ensureVersion);

  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const record of records) {
      if (changed.has(record.key)) continue;
      const dependsOnChangedPack = (record.manifest.dependencies || []).some((dependency) => dependency?.uuid && versions.has(dependency.uuid));
      if (!dependsOnChangedPack) continue;
      changed.add(record.key);
      ensureVersion(record);
      expanded = true;
    }
  }
  return { records, changed, versions };
}

async function applyBedrockVersionPlan(zip, containerId, plan, { rootPrefix = "", normalizeRoot = false } = {}) {
  if (!plan) return false;
  let modified = false;
  for (const record of plan.records.filter((item) => item.containerId === containerId)) {
    const manifest = cloneJson(record.manifest);
    let changed = false;
    const nextVersion = plan.versions.get(record.uuid);
    if (plan.changed.has(record.key) && nextVersion) {
      manifest.header.version = [...nextVersion];
      for (const module of manifest.modules || []) {
        if (Array.isArray(module.version)) module.version = [...nextVersion];
      }
      changed = true;
    }
    for (const dependency of manifest.dependencies || []) {
      const dependencyVersion = dependency?.uuid && plan.versions.get(dependency.uuid);
      if (dependencyVersion && Array.isArray(dependency.version)) {
        dependency.version = [...dependencyVersion];
        changed = true;
      }
    }
    if (changed) {
      const outputPath = normalizeRoot && record.path.startsWith(rootPrefix)
        ? record.path.slice(rootPrefix.length)
        : record.path;
      zip.file(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
      modified = true;
    }
  }
  return modified;
}

export async function buildArtifactArchive(project, {
  outputType = "blob",
  entriesById,
  includeEntry,
  archiveOptions,
  resourcePackMetadata,
  renderDocument,
  bedrockTranslationMode = "localized",
} = {}) {
  const forceBedrockSource =
    bedrockTranslationMode === "forced" &&
    ["bedrock_addon", "bedrock_world"].includes(project.artifactType);
  const render = (document) => {
    try {
      return renderArtifactDocument(document, entriesById, includeEntry);
    } catch (error) {
      if (typeof renderDocument === "function") return renderDocument(document, entriesById, includeEntry);
      throw error;
    }
  };
  if (project.artifactType === "server_plugin") {
    const patch = new JSZip();
    const base = `plugins/${String(project.mod?.name || "plugin").replace(/[^A-Za-z0-9_.-]+/g, "-")}`;
    for (const document of project.documents || []) {
      patch.file(`${base}/${document.outputPath}`, render(document));
    }
    patch.file("README.txt", "Back up the server, copy the plugins folder into the server directory, and restart the server.\nサーバーをバックアップし、pluginsフォルダーをサーバーへ上書きしてから再起動してください。\n");
    return {
      archive: await patch.generateAsync(archiveOptions(outputType)),
      filename: `${String(project.fileName).replace(ARCHIVE_EXTENSION, "")}.${project.targetLocale}.plugin-translation.zip`,
    };
  }

  if (project.artifactType === "resource_pack" && project.edition === "java") {
    const overlay = new JSZip();
    overlay.file("pack.mcmeta", `${JSON.stringify(resourcePackMetadata, null, 2)}\n`);
    for (const document of project.documents || []) {
      const path = document.outputPath.replace(/^.*?(assets\/)/i, "$1");
      if (path.startsWith("assets/")) overlay.file(path, render(document));
    }
    return {
      archive: await overlay.generateAsync(archiveOptions(outputType)),
      filename: `${String(project.fileName).replace(ARCHIVE_EXTENSION, "")}.${project.targetLocale}.zip`,
    };
  }

  let root = await JSZip.loadAsync(project.artifactState.sourceBytes, { createFolders: false });
  const bedrockVersionPlan = await prepareBedrockVersionPlan(project, root);
  const rootPrefix = project.artifact?.rootPrefix || "";
  const normalizeRoot = Boolean(rootPrefix) && (
    project.artifactType === "data_pack" ||
    project.artifactType === "bedrock_world" ||
    project.artifactType === "bedrock_addon" ||
    (project.artifactType === "resource_pack" && project.edition === "bedrock")
  );
  if (normalizeRoot) {
    const normalized = new JSZip();
    for (const entry of Object.values(root.files)) {
      if (entry.dir || !entry.name.startsWith(rootPrefix)) continue;
      normalized.file(entry.name.slice(rootPrefix.length), await entry.async("uint8array"));
    }
    root = normalized;
  }
  const documentsByContainer = new Map();
  for (const document of project.documents || []) {
    if (!documentsByContainer.has(document.containerId)) documentsByContainer.set(document.containerId, []);
    documentsByContainer.get(document.containerId).push(document);
  }

  const applyDocuments = async (zip, documents, pathPrefix = "") => {
    for (const document of documents || []) {
      if (document.format === "bedrock-leveldb-nbt") continue;
      const prefix = pathPrefix || (
        normalizeRoot && document.containerId === "root" ? rootPrefix : ""
      );
      const outputPath = prefix && document.outputPath.startsWith(prefix)
        ? document.outputPath.slice(prefix.length)
        : document.outputPath;
      const sourceOutputPath = prefix && document.sourcePath.startsWith(prefix)
        ? document.sourcePath.slice(prefix.length)
        : document.sourcePath;
      const forcedBedrockDocument = forceBedrockSource && document.format === "bedrock-lang";
      const forcedContents = forcedBedrockDocument
        ? renderArtifactDocument(document, entriesById, includeEntry, {
            preserveUntranslated: true,
          })
        : null;
      zip.file(
        outputPath,
        forcedBedrockDocument && sourceOutputPath === outputPath
          ? forcedContents
          : render(document),
      );
      if (forcedBedrockDocument && sourceOutputPath !== outputPath) {
        zip.file(sourceOutputPath, forcedContents);
      }
      if (document.format === "bedrock-lang") {
        const languagesPath = outputPath.replace(/[^/]+\.lang$/i, "languages.json");
        const existing = zip.file(languagesPath);
        let languages = [];
        if (existing) {
          try {
            const parsed = JSON.parse(await existing.async("string"));
            if (Array.isArray(parsed)) languages = parsed.filter((item) => typeof item === "string");
          } catch {
            // Replace an invalid language list with the target locale only.
          }
        }
        if (!languages.includes(project.targetLocale)) languages.push(project.targetLocale);
        zip.file(languagesPath, `${JSON.stringify(languages, null, 2)}\n`);
      }
    }
  };

  await applyDocuments(root, documentsByContainer.get("root"));
  const levelDbPatch = project.artifactState?.levelDb
    ? (await import("./bedrock-leveldb.js")).buildBedrockLevelDbPatch(
        project,
        entriesById,
        includeEntry,
      )
    : null;
  if (levelDbPatch) {
    const patchPath = normalizeRoot && levelDbPatch.path.startsWith(rootPrefix)
      ? levelDbPatch.path.slice(rootPrefix.length)
      : levelDbPatch.path;
    if (root.file(patchPath)) throw new Error("Bedrock LevelDBパッチのファイル番号が重複しています。");
    root.file(patchPath, levelDbPatch.bytes);
  }
  await applyBedrockVersionPlan(root, "root", bedrockVersionPlan, { rootPrefix, normalizeRoot });

  if (project.artifactType === "modpack") {
    const overlay = new JSZip();
    let overlayEntries = 0;
    for (const document of (project.documents || []).filter((item) => item.containerId !== "root" && /(^|\/)assets\//i.test(item.outputPath) && !item.requiresInstanceInstall)) {
      overlay.file(document.outputPath.replace(/^.*?(assets\/)/i, "$1"), render(document));
      overlayEntries += 1;
    }
    if (overlayEntries) {
      overlay.file("pack.mcmeta", `${JSON.stringify(resourcePackMetadata || { pack: { pack_format: 34, description: `Babel Breaker ${project.targetLocale}` } }, null, 2)}\n`);
      const folder = project.artifact.variant === "modrinth"
        ? "client-overrides/resourcepacks"
        : project.artifact.variant === "curseforge"
          ? "overrides/resourcepacks"
          : "resourcepacks";
      root.file(`${folder}/BabelBreaker-${project.targetLocale}.zip`, await overlay.generateAsync(archiveOptions("uint8array")));
    }
    const archive = await root.generateAsync(archiveOptions(outputType));
    const original = project.fileName.replace(ARCHIVE_EXTENSION, "");
    return { archive, filename: `${original}.${project.targetLocale}${project.artifact.extension}` };
  }

  for (const container of project.artifactState.containers.filter((item) => item.parentId === "root")) {
    const childDocuments = documentsByContainer.get(container.id);
    const needsManifestUpdate = bedrockVersionPlan?.records.some((record) =>
      record.containerId === container.id && (
        bedrockVersionPlan.changed.has(record.key) ||
        (record.manifest.dependencies || []).some((dependency) => dependency?.uuid && bedrockVersionPlan.versions.has(dependency.uuid))
      ),
    );
    const needsPackExtensionNormalization =
      project.artifactType === "bedrock_addon" && /\.zip$/i.test(container.entryPath);
    if (!childDocuments?.length && !needsManifestUpdate && !needsPackExtensionNormalization) continue;
    let child = await JSZip.loadAsync(container.sourceBytes, { createFolders: false });
    const childRootPrefix = project.artifactType === "bedrock_addon"
      ? container.rootPrefix || ""
      : "";
    if (childRootPrefix) {
      const normalizedChild = new JSZip();
      for (const entry of Object.values(child.files)) {
        if (entry.dir || !entry.name.startsWith(childRootPrefix)) continue;
        normalizedChild.file(entry.name.slice(childRootPrefix.length), await entry.async("uint8array"));
      }
      child = normalizedChild;
    }
    await applyDocuments(child, childDocuments, childRootPrefix);
    await applyBedrockVersionPlan(child, container.id, bedrockVersionPlan, {
      rootPrefix: childRootPrefix,
      normalizeRoot: Boolean(childRootPrefix),
    });
    let entryPath = normalizeRoot && container.entryPath.startsWith(rootPrefix)
      ? container.entryPath.slice(rootPrefix.length)
      : container.entryPath;
    if (project.artifactType === "bedrock_addon" && /\.zip$/i.test(entryPath)) {
      root.remove(entryPath);
      entryPath = entryPath.replace(/\.zip$/i, ".mcpack");
    }
    root.file(entryPath, await child.generateAsync(archiveOptions("uint8array")));
  }

  const archive = await root.generateAsync(archiveOptions(outputType));
  const original = project.fileName.replace(ARCHIVE_EXTENSION, "");
  const extension = project.artifact.extension || project.fileName.match(/\.[^.]+$/)?.[0] || ".zip";
  const modeSuffix = forceBedrockSource ? ".forced" : "";
  return { archive, filename: `${original}.${project.targetLocale}${modeSuffix}${extension}` };
}
