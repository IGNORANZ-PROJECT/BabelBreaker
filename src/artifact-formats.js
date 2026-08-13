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

function translatedArchiveStem(fileName, targetLocale) {
  const stem = String(fileName).replace(ARCHIVE_EXTENSION, "");
  const escapedLocale = String(targetLocale).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return stem.replace(new RegExp(`\\.${escapedLocale}(?:\\.forced)?$`, "i"), "");
}

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

function parseBedrockJson(text) {
  const source = String(text).replace(/^\uFEFF/, "");
  let withoutComments = "";
  let inString = false;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (character === "\n" || character === "\r") {
        lineComment = false;
        withoutComments += character;
      }
      continue;
    }
    if (blockComment) {
      if (character === "*" && next === "/") {
        blockComment = false;
        index += 1;
      } else if (character === "\n" || character === "\r") {
        withoutComments += character;
      }
      continue;
    }
    if (inString) {
      withoutComments += character;
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      withoutComments += character;
    } else if (character === "/" && next === "/") {
      lineComment = true;
      index += 1;
    } else if (character === "/" && next === "*") {
      blockComment = true;
      index += 1;
    } else {
      withoutComments += character;
    }
  }
  if (blockComment) throw new SyntaxError("Unterminated JSON block comment");

  let normalized = "";
  inString = false;
  escaped = false;
  for (let index = 0; index < withoutComments.length; index += 1) {
    const character = withoutComments[index];
    if (inString) {
      normalized += character;
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      normalized += character;
      continue;
    }
    if (character === ",") {
      let nextIndex = index + 1;
      while (/\s/.test(withoutComments[nextIndex] || "")) nextIndex += 1;
      if (withoutComments[nextIndex] === "}" || withoutComments[nextIndex] === "]") continue;
    }
    normalized += character;
  }
  return JSON.parse(normalized);
}

async function readJson(entry) {
  try {
    return parseBedrockJson(await entry.async("string"));
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
    const bedrockManifests = [];
    for (const entry of entries.filter((item) => !item.dir && /(^|\/)manifest\.json$/i.test(item.name))) {
      const value = await readJson(entry);
      if (value && Array.isArray(value.modules)) bedrockManifests.push({ path: entry.name, manifest: value });
    }
    const moduleTypes = new Set(
      bedrockManifests.flatMap((item) => item.manifest.modules || []).map((module) => module?.type),
    );
    if ([...moduleTypes].some((type) => ["resources", "data", "script", "world_template"].includes(type))) {
      const variant = bedrockManifests.length === 1 && moduleTypes.has("resources") && !moduleTypes.has("data") && !moduleTypes.has("script")
        ? "bedrock-resource-pack"
        : "bedrock-addon";
      return {
        ...(variant === "bedrock-resource-pack"
          ? { ...ARTIFACT_TYPES.resource_pack, edition: "bedrock" }
          : ARTIFACT_TYPES.bedrock_addon),
        variant,
        confidence: "high",
        rootPrefix: bedrockManifests.length === 1
          ? markerPrefix(bedrockManifests[0].path, "manifest.json")
          : "",
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

// Bedrock accepts UUID-shaped identifiers from older tooling that do not
// always set the RFC version/variant bits, so validate the shape only.
const BEDROCK_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validBedrockVersion(value) {
  return Array.isArray(value)
    && value.length === 3
    && value.every((part) => Number.isInteger(Number(part)) && Number(part) >= 0);
}

/**
 * Validate the parts of a Bedrock manifest that commonly make Minecraft reject
 * an otherwise readable archive. The original UUIDs and file layout are never
 * rewritten by this validator.
 */
export async function validateBedrockPack(zip, { label = "Bedrock pack" } = {}) {
  const errors = [];
  const warnings = [];
  const manifests = manifestEntries(zip);
  if (manifests.length !== 1) {
    errors.push(`${label}: manifest.json must appear exactly once (found ${manifests.length}).`);
    return { valid: false, errors, warnings, manifestPath: "" };
  }
  const manifestEntry = manifests[0];
  const manifest = await readJson(manifestEntry);
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    errors.push(`${label}: manifest.json is not valid JSON.`);
    return { valid: false, errors, warnings, manifestPath: manifestEntry.name };
  }
  if (![1, 2, 3].includes(Number(manifest.format_version))) {
    errors.push(`${label}: manifest format_version is missing or unsupported.`);
  }
  if (!manifest.header || typeof manifest.header !== "object") {
    errors.push(`${label}: manifest header is missing.`);
  } else {
    if (!String(manifest.header.name || "").trim()) errors.push(`${label}: manifest header.name is missing.`);
    if (!BEDROCK_UUID.test(String(manifest.header.uuid || ""))) errors.push(`${label}: manifest header.uuid is invalid.`);
    if (!validBedrockVersion(manifest.header.version)) errors.push(`${label}: manifest header.version is invalid.`);
    if (!String(manifest.header.description || "").trim()) warnings.push(`${label}: manifest header.description is missing.`);
  }
  if (!Array.isArray(manifest.modules) || !manifest.modules.length) {
    errors.push(`${label}: manifest modules are missing.`);
  } else {
    const uuids = new Set([String(manifest.header?.uuid || "").toLowerCase()].filter(Boolean));
    manifest.modules.forEach((module, index) => {
      const prefix = `${label}: module ${index + 1}`;
      const uuid = String(module?.uuid || "").toLowerCase();
      if (!String(module?.type || "").trim()) errors.push(`${prefix} type is missing.`);
      if (!BEDROCK_UUID.test(uuid)) errors.push(`${prefix} uuid is invalid.`);
      if (uuids.has(uuid)) errors.push(`${prefix} uuid is duplicated.`);
      uuids.add(uuid);
      if (!validBedrockVersion(module?.version)) errors.push(`${prefix} version is invalid.`);
    });
  }
  for (const [index, dependency] of (Array.isArray(manifest.dependencies) ? manifest.dependencies : []).entries()) {
    if (dependency?.uuid && !BEDROCK_UUID.test(String(dependency.uuid))) {
      errors.push(`${label}: dependency ${index + 1} uuid is invalid.`);
    }
    if (dependency?.uuid && !validBedrockVersion(dependency.version)) {
      errors.push(`${label}: dependency ${index + 1} version is invalid.`);
    }
  }
  return {
    valid: errors.length === 0,
    errors,
    warnings,
    manifestPath: manifestEntry.name,
  };
}

export async function validateBedrockAddonArchive(zip, { label = "Bedrock Add-on" } = {}) {
  const errors = [];
  const warnings = [];
  const packs = [];
  const outerFiles = Object.values(zip.files).filter((entry) => !entry.dir);
  const addPack = async (packZip, name) => {
    const result = await validateBedrockPack(packZip, { label: `${label} (${name})` });
    errors.push(...result.errors);
    warnings.push(...result.warnings);
    if (!result.valid) return;
    const manifestEntry = manifestEntries(packZip)[0];
    packs.push({ name, manifest: await readJson(manifestEntry) });
  };

  for (const manifestEntry of manifestEntries(zip)) {
    const prefix = manifestEntry.name.slice(0, -"manifest.json".length);
    const packZip = new JSZip();
    for (const entry of outerFiles) {
      if (!entry.name.startsWith(prefix)) continue;
      packZip.file(entry.name.slice(prefix.length), await entry.async("uint8array"));
    }
    await addPack(packZip, prefix.replace(/\/$/, "") || "root pack");
  }

  for (const entry of outerFiles.filter((item) => /\.(?:mcpack|zip)$/i.test(item.name))) {
    try {
      const packZip = await JSZip.loadAsync(await entry.async("uint8array"), {
        createFolders: false,
        checkCRC32: true,
      });
      if (!manifestEntries(packZip).length && /\.zip$/i.test(entry.name)) continue;
      await addPack(packZip, entry.name);
    } catch (error) {
      errors.push(`${label}: ${entry.name} cannot be opened (${error.message}).`);
    }
  }

  if (!packs.length && !outerFiles.some((entry) => /\.mcworld$/i.test(entry.name))) {
    errors.push(`${label}: no importable .mcpack or .mcworld was found.`);
  }

  const identities = new Map();
  const headers = new Map();
  for (const pack of packs) {
    const headerUuid = String(pack.manifest.header?.uuid || "").toLowerCase();
    if (headerUuid) {
      headers.set(headerUuid, { name: pack.name, version: pack.manifest.header?.version });
      if (!identities.has(headerUuid)) identities.set(headerUuid, []);
      identities.get(headerUuid).push(`${pack.name} header`);
    }
    for (const [index, module] of (pack.manifest.modules || []).entries()) {
      const moduleUuid = String(module?.uuid || "").toLowerCase();
      if (!moduleUuid) continue;
      if (!identities.has(moduleUuid)) identities.set(moduleUuid, []);
      identities.get(moduleUuid).push(`${pack.name} module ${index + 1}`);
    }
  }
  for (const [uuid, owners] of identities) {
    if (owners.length > 1) {
      errors.push(`${label}: UUID ${uuid} is duplicated (${owners.join(", ")}).`);
    }
  }
  for (const pack of packs) {
    for (const dependency of (pack.manifest.dependencies || []).filter((item) => item?.uuid)) {
      const target = headers.get(String(dependency.uuid).toLowerCase());
      if (!target) continue;
      if (
        !validBedrockVersion(dependency.version) ||
        dependency.version.some((part, index) => Number(part) !== Number(target.version?.[index]))
      ) {
        errors.push(`${label}: ${pack.name} dependency version does not match ${target.name}.`);
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings, packs: packs.map((pack) => pack.name) };
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function deterministicBedrockUuid(seed) {
  const words = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35];
  for (let wordIndex = 0; wordIndex < words.length; wordIndex += 1) {
    let hash = words[wordIndex] >>> 0;
    for (let index = 0; index < seed.length; index += 1) {
      hash ^= seed.charCodeAt(index) + wordIndex * 31;
      hash = Math.imul(hash, 0x01000193) >>> 0;
      hash ^= hash >>> 13;
    }
    words[wordIndex] = hash >>> 0;
  }
  const bytes = words.flatMap((word) => [word >>> 24, word >>> 16, word >>> 8, word].map((part) => part & 0xff));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
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
        prefix: entry.name.slice(0, -"manifest.json".length),
      });
    }
  }

  // A translated pack is a separate installable copy. Reusing the source UUID
  // makes a later download fail whenever Minecraft still has an older export
  // installed, even if the browser cache or world was cleared.
  const exportNonce = globalThis.crypto?.randomUUID?.()
    || `${Date.now()}-${Math.random()}`;
  const headerUuids = new Map();
  const rekeys = new Map();
  for (const record of records) {
    const container = containers.find((item) => item.id === record.containerId);
    const sourceHeaderUuid = String(record.manifest.header?.uuid || "").toLowerCase();
    const headerUuid = deterministicBedrockUuid(`${exportNonce}:${record.key}:header`);
    const moduleUuids = (record.manifest.modules || []).map((_, moduleIndex) =>
      deterministicBedrockUuid(`${exportNonce}:${record.key}:module:${moduleIndex}`));
    rekeys.set(record.key, { headerUuid, moduleUuids });
    if (BEDROCK_UUID.test(sourceHeaderUuid) && !headerUuids.has(sourceHeaderUuid)) {
      headerUuids.set(sourceHeaderUuid, headerUuid);
    }
    for (const dependency of record.manifest.dependencies || []) {
      if (!String(dependency?.module_name || "").startsWith("@minecraft/")) continue;
      const stableVersion = String(dependency.version || "").match(/^(\d+\.\d+\.\d+)-beta$/i)?.[1];
      if (stableVersion) dependency.version = stableVersion;
    }
    for (const module of record.manifest.modules || []) {
      if (module?.type !== "script") continue;
      if (String(module.language || "").toLowerCase() === "javascript" && module.language !== "javascript") {
        module.language = "javascript";
      } else if (!module.language) {
        module.language = "javascript";
      }
      const entryPath = String(module.entry || "");
      if (
        entryPath &&
        safePath(entryPath) &&
        container &&
        !container.zip.file(`${record.prefix}${entryPath}`) &&
        container.zip.file(`${record.prefix}scripts/${entryPath}`)
      ) {
        module.entry = `scripts/${entryPath}`;
      }
    }
  }

  return { records, headerUuids, rekeys };
}

async function applyBedrockVersionPlan(zip, containerId, plan, { rootPrefix = "", normalizeRoot = false } = {}) {
  if (!plan) return false;
  let modified = false;
  for (const record of plan.records.filter((item) => item.containerId === containerId)) {
    const manifest = cloneJson(record.manifest);
    const rekey = plan.rekeys.get(record.key);
    if (!rekey) continue;
    manifest.header.uuid = rekey.headerUuid;
    (manifest.modules || []).forEach((module, index) => {
      module.uuid = rekey.moduleUuids[index];
    });
    for (const dependency of manifest.dependencies || []) {
      const dependencyUuid = dependency?.uuid
        && plan.headerUuids.get(String(dependency.uuid).toLowerCase());
      if (dependencyUuid) dependency.uuid = dependencyUuid;
    }
    const outputPath = normalizeRoot && record.path.startsWith(rootPrefix)
      ? record.path.slice(rootPrefix.length)
      : record.path;
    zip.file(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
    modified = true;
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
    for (const replacement of project.imageReplacements || []) {
      const path = replacement.path.replace(/^.*?(assets\/)/i, "$1");
      if (replacement.containerId === "root" && path.startsWith("assets/")) {
        overlay.file(path, replacement.bytes);
      }
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
  for (const replacement of (project.imageReplacements || []).filter((item) => item.containerId === "root")) {
    const outputPath = normalizeRoot && replacement.path.startsWith(rootPrefix)
      ? replacement.path.slice(rootPrefix.length)
      : replacement.path;
    root.file(outputPath, replacement.bytes);
  }
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
    for (const replacement of (project.imageReplacements || []).filter((item) => item.containerId !== "root" && /(^|\/)assets\//i.test(item.path))) {
      overlay.file(replacement.path.replace(/^.*?(assets\/)/i, "$1"), replacement.bytes);
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
    const original = translatedArchiveStem(project.fileName, project.targetLocale);
    return { archive, filename: `${original}.${project.targetLocale}${project.artifact.extension}` };
  }

  for (const container of project.artifactState.containers.filter((item) => item.parentId === "root")) {
    const childDocuments = documentsByContainer.get(container.id);
    const childImageReplacements = (project.imageReplacements || []).filter((item) => item.containerId === container.id);
    const needsManifestUpdate = bedrockVersionPlan?.records.some(
      (record) => record.containerId === container.id,
    );
    if (!childDocuments?.length && !needsManifestUpdate && !childImageReplacements.length) continue;
    let child = await JSZip.loadAsync(container.sourceBytes, { createFolders: false });
    const childRootPrefix = project.artifactType === "bedrock_addon"
      ? container.rootPrefix || ""
      : "";
    // Keep the author's container filename, wrapper directory, and archive
    // layout. Minecraft packs in the wild rely on both loose and nested forms.
    await applyDocuments(child, childDocuments);
    for (const replacement of childImageReplacements) child.file(replacement.path, replacement.bytes);
    await applyBedrockVersionPlan(child, container.id, bedrockVersionPlan, {
      rootPrefix: childRootPrefix,
      normalizeRoot: false,
    });
    let entryPath = normalizeRoot && container.entryPath.startsWith(rootPrefix)
      ? container.entryPath.slice(rootPrefix.length)
      : container.entryPath;
    root.file(entryPath, await child.generateAsync(archiveOptions("uint8array")));
  }

  if (project.artifactType === "bedrock_addon") {
    const result = await validateBedrockAddonArchive(root, { label: project.fileName });
    if (!result.valid) {
      throw new Error(`Bedrock Add-on output validation failed: ${result.errors.join(" ")}`);
    }
  } else if (project.edition === "bedrock" && project.artifactType === "resource_pack") {
    const result = await validateBedrockPack(root, { label: project.fileName });
    if (!result.valid) throw new Error(`Bedrock pack output validation failed: ${result.errors.join(" ")}`);
  }

  const archive = await root.generateAsync(archiveOptions(outputType));
  const original = translatedArchiveStem(project.fileName, project.targetLocale);
  const extension = project.artifact.extension || project.fileName.match(/\.[^.]+$/)?.[0] || ".zip";
  const modeSuffix = forceBedrockSource ? ".forced" : "";
  return { archive, filename: `${original}.${project.targetLocale}${modeSuffix}${extension}` };
}
