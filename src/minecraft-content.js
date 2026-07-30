import {
  NBT_TAG,
  cloneNbtDocument,
  parseNbt,
  writeNbt,
} from "./nbt.js";

const TRANSLATABLE_TEXT_PATTERN = /\p{L}/u;
const PATCHOULI_FIELDS = new Set([
  "description",
  "header",
  "landing_text",
  "name",
  "subtitle",
  "text",
  "title",
]);
const QUEST_FIELDS = new Set([
  "desc",
  "description",
  "name",
  "subtitle",
  "text",
  "title",
]);
const SOURCE_LOCALE_PRIORITY = ["en_us", "en_gb"];

function defineOwnValue(target, key, value) {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizedFieldName(value) {
  return String(value || "").split(":")[0].toLowerCase();
}

function pathKey(path) {
  return JSON.stringify(path);
}

function displayPath(path) {
  return path
    .map((part, index) =>
      typeof part === "number"
        ? `[${part}]`
        : index
          ? `.${part}`
          : String(part),
    )
    .join("");
}

function valueAtPath(value, path) {
  let current = value;
  for (const part of path) {
    if (current === null || current === undefined) return undefined;
    current = current[part];
  }
  return current;
}

function setValueAtPath(value, path, replacement) {
  if (!path.length) return;
  const parent = valueAtPath(value, path.slice(0, -1));
  if (parent !== null && parent !== undefined) {
    parent[path.at(-1)] = replacement;
  }
}

function isLocalizationKey(value) {
  const text = String(value || "").trim();
  return (
    text === text.toLowerCase() &&
    /^[a-z0-9_-]+(?:\.[a-z0-9_-]+)+$/.test(text)
  );
}

function isTranslatableString(value, { skipLocalizationKeys = false } = {}) {
  const text = String(value || "");
  if (!text.trim() || !TRANSLATABLE_TEXT_PATTERN.test(text)) return false;
  if (skipLocalizationKeys && isLocalizationKey(text)) return false;
  return true;
}

function collectJsonRecords(
  value,
  {
    fields,
    skipLocalizationKeys = false,
    path = [],
    records = [],
  },
) {
  if (Array.isArray(value)) {
    value.forEach((child, index) =>
      collectJsonRecords(child, {
        fields,
        skipLocalizationKeys,
        path: [...path, index],
        records,
      }),
    );
    return records;
  }
  if (!value || typeof value !== "object") return records;

  for (const [key, child] of Object.entries(value)) {
    const childPath = [...path, key];
    if (
      typeof child === "string" &&
      fields.has(normalizedFieldName(key)) &&
      isTranslatableString(child, { skipLocalizationKeys })
    ) {
      records.push({
        key: pathKey(childPath),
        displayKey: displayPath(childPath),
        source: child,
        locator: { type: "json", path: childPath },
      });
      continue;
    }
    collectJsonRecords(child, {
      fields,
      skipLocalizationKeys,
      path: childPath,
      records,
    });
  }
  return records;
}

function chooseLocaleDocument(candidates, targetLocale) {
  return [...candidates].sort((left, right) => {
    const leftPriority = SOURCE_LOCALE_PRIORITY.indexOf(left.locale);
    const rightPriority = SOURCE_LOCALE_PRIORITY.indexOf(right.locale);
    const leftScore =
      leftPriority >= 0 ? leftPriority : left.locale === targetLocale ? 999 : 100;
    const rightScore =
      rightPriority >= 0
        ? rightPriority
        : right.locale === targetLocale
          ? 999
          : 100;
    if (leftScore !== rightScore) return leftScore - rightScore;
    return left.path.localeCompare(right.path);
  })[0];
}

function attachExistingTargets(records, targetRecords) {
  const targets = new Map(
    (targetRecords || []).map((record) => [record.key, record.source]),
  );
  return records.map((record) => ({
    ...record,
    existingTarget: targets.get(record.key),
  }));
}

function decodeSnbtString(raw) {
  const body = raw.slice(1, -1);
  let result = "";
  for (let index = 0; index < body.length; index += 1) {
    const character = body[index];
    if (character !== "\\" || index === body.length - 1) {
      result += character;
      continue;
    }
    const escaped = body[++index];
    const escapes = {
      b: "\b",
      f: "\f",
      n: "\n",
      r: "\r",
      t: "\t",
    };
    if (escaped === "u" && /^[0-9a-fA-F]{4}$/.test(body.slice(index + 1, index + 5))) {
      result += String.fromCodePoint(
        Number.parseInt(body.slice(index + 1, index + 5), 16),
      );
      index += 4;
    } else {
      result += escapes[escaped] ?? escaped;
    }
  }
  return result;
}

function encodeSnbtString(value, quote = '"') {
  const escaped = String(value)
    .replaceAll("\\", "\\\\")
    .replaceAll("\b", "\\b")
    .replaceAll("\f", "\\f")
    .replaceAll("\n", "\\n")
    .replaceAll("\r", "\\r")
    .replaceAll("\t", "\\t")
    .replaceAll(quote, `\\${quote}`);
  return `${quote}${escaped}${quote}`;
}

function tokenizeSnbt(text) {
  const tokens = [];
  let index = 0;
  while (index < text.length) {
    const character = text[index];
    if (/\s/.test(character)) {
      index += 1;
      continue;
    }
    if (character === "#") {
      index = text.indexOf("\n", index);
      if (index < 0) break;
      continue;
    }
    if (character === "/" && text[index + 1] === "/") {
      index = text.indexOf("\n", index + 2);
      if (index < 0) break;
      continue;
    }
    if (`{}[]:,;`.includes(character)) {
      tokens.push({
        type: "punctuation",
        value: character,
        start: index,
        end: index + 1,
      });
      index += 1;
      continue;
    }
    if (character === '"' || character === "'") {
      const quote = character;
      const start = index++;
      let escaped = false;
      let closed = false;
      while (index < text.length) {
        const current = text[index++];
        if (escaped) {
          escaped = false;
        } else if (current === "\\") {
          escaped = true;
        } else if (current === quote) {
          closed = true;
          break;
        }
      }
      if (!closed) {
        throw new Error("SNBT内に閉じられていない文字列があります。");
      }
      const raw = text.slice(start, index);
      tokens.push({
        type: "string",
        value: decodeSnbtString(raw),
        quote,
        raw,
        start,
        end: index,
      });
      continue;
    }
    const start = index;
    while (
      index < text.length &&
      !/\s/.test(text[index]) &&
      !`{}[]:,;`.includes(text[index])
    ) {
      index += 1;
    }
    tokens.push({
      type: "bare",
      value: text.slice(start, index),
      start,
      end: index,
    });
  }
  return tokens;
}

function collectRawJsonText(value) {
  const trimmed = String(value || "").trim();
  if (!/^[{[]/.test(trimmed)) return null;
  let data;
  try {
    data = JSON.parse(trimmed);
  } catch {
    return null;
  }
  const records = [];
  const visit = (child, path = [], visibleArray = false) => {
    if (typeof child === "string") {
      if (visibleArray && isTranslatableString(child)) {
        records.push({
          path,
          source: child,
        });
      }
      return;
    }
    if (Array.isArray(child)) {
      child.forEach((item, index) => visit(item, [...path, index], true));
      return;
    }
    if (!child || typeof child !== "object") return;
    for (const [key, item] of Object.entries(child)) {
      const itemPath = [...path, key];
      if (
        key === "text" &&
        typeof item === "string" &&
        isTranslatableString(item)
      ) {
        records.push({ path: itemPath, source: item });
      } else if (key === "extra" || key === "with" || key === "contents") {
        visit(item, itemPath, true);
      }
    }
  };
  visit(data, [], Array.isArray(data));
  return records.length ? { data, records } : null;
}

function collectSnbtRecords(text, mode = "all") {
  const tokens = tokenizeSnbt(text);
  const records = [];
  let cursor = 0;

  const addStringRecord = (tokenIndex, path, fieldName) => {
    const token = tokens[tokenIndex];
    const shouldInclude =
      mode === "all" || QUEST_FIELDS.has(normalizedFieldName(fieldName));
    if (!shouldInclude) return;
    const rawJson = collectRawJsonText(token.value);
    if (rawJson) {
      for (const component of rawJson.records) {
        const componentKey = `${pathKey(path)}#${pathKey(component.path)}`;
        records.push({
          key: componentKey,
          displayKey: `${displayPath(path)} · ${displayPath(component.path)}`,
          source: component.source,
          locator: {
            type: "snbt",
            tokenIndex,
            jsonPath: component.path,
          },
        });
      }
    } else if (isTranslatableString(token.value)) {
      records.push({
        key: pathKey(path),
        displayKey: displayPath(path),
        source: token.value,
        locator: { type: "snbt", tokenIndex, jsonPath: null },
      });
    }
  };

  const parseValue = (path, fieldName) => {
    const token = tokens[cursor];
    if (!token) return;
    if (token.type === "string") {
      addStringRecord(cursor, path, fieldName);
      cursor += 1;
      return;
    }
    if (token.value === "{") {
      cursor += 1;
      while (cursor < tokens.length && tokens[cursor].value !== "}") {
        if (tokens[cursor].value === ",") {
          cursor += 1;
          continue;
        }
        const keyToken = tokens[cursor++];
        const key = String(keyToken?.value ?? "");
        if (tokens[cursor]?.value !== ":") {
          throw new Error(`SNBTの${displayPath(path) || "ルート"}を解析できません。`);
        }
        cursor += 1;
        parseValue([...path, key], key);
        if (tokens[cursor]?.value === ",") cursor += 1;
      }
      if (tokens[cursor]?.value !== "}") {
        throw new Error("SNBT内のオブジェクトが閉じられていません。");
      }
      cursor += 1;
      return;
    }
    if (token.value === "[") {
      cursor += 1;
      if (
        tokens[cursor]?.type === "bare" &&
        tokens[cursor + 1]?.value === ";"
      ) {
        cursor += 2;
      }
      let index = 0;
      while (cursor < tokens.length && tokens[cursor].value !== "]") {
        if (tokens[cursor].value === ",") {
          cursor += 1;
          continue;
        }
        parseValue([...path, index], fieldName);
        index += 1;
        if (tokens[cursor]?.value === ",") cursor += 1;
      }
      if (tokens[cursor]?.value !== "]") {
        throw new Error("SNBT内の配列が閉じられていません。");
      }
      cursor += 1;
      return;
    }
    cursor += 1;
  };

  while (cursor < tokens.length) {
    parseValue([], "");
  }
  return { tokens, records };
}

function replaceSnbtValues(document, records, resolveValue) {
  const replacements = new Map();
  const componentGroups = new Map();

  for (const record of records) {
    const value = resolveValue(record);
    if (value === undefined) continue;
    const { tokenIndex, jsonPath } = record.locator;
    if (!jsonPath) {
      replacements.set(tokenIndex, value);
      continue;
    }
    if (!componentGroups.has(tokenIndex)) componentGroups.set(tokenIndex, []);
    componentGroups.get(tokenIndex).push({ jsonPath, value });
  }

  for (const [tokenIndex, components] of componentGroups) {
    const token = document.tokens[tokenIndex];
    try {
      const data = JSON.parse(token.value);
      components.forEach(({ jsonPath, value }) =>
        setValueAtPath(data, jsonPath, value),
      );
      replacements.set(tokenIndex, JSON.stringify(data));
    } catch {
      // A malformed raw component is left unchanged.
    }
  }

  const edits = [...replacements].map(([tokenIndex, value]) => {
    const token = document.tokens[tokenIndex];
    return {
      start: token.start,
      end: token.end,
      text: encodeSnbtString(value, token.quote),
    };
  });
  let output = document.sourceText;
  for (const edit of edits.sort((left, right) => right.start - left.start)) {
    output = `${output.slice(0, edit.start)}${edit.text}${output.slice(edit.end)}`;
  }
  return output;
}

async function readJsonDocument(entry, readText) {
  const sourceText = await readText(entry, entry.name);
  return {
    sourceText,
    data: JSON.parse(sourceText),
  };
}

async function extractPatchouliDocuments(
  archiveEntries,
  { readText, targetLocale },
) {
  const warnings = [];
  const candidates = [];
  const externalBooks = [];
  const pattern =
    /^assets\/([^/]+)\/patchouli_books\/([^/]+)\/([^/]+)\/(categories|entries|templates)\/(.+\.json)$/i;
  for (const entry of archiveEntries) {
    if (entry.dir) continue;
    const match = entry.name.match(pattern);
    if (match) {
      candidates.push({
        entry,
        namespace: match[1],
        book: match[2],
        locale: match[3].toLowerCase(),
        section: match[4].toLowerCase(),
        relativePath: match[5],
        path: entry.name,
        root: `assets/${match[1]}/patchouli_books/`,
        requiresInstanceInstall: false,
        groupKey: `resource\u0000${match[1]}\u0000${match[2]}\u0000${match[4]}\u0000${match[5]}`,
      });
      continue;
    }
    const externalBookMatch = entry.name.match(
      /^((?:overrides\/|minecraft\/|\.minecraft\/)?patchouli_books\/)([^/]+)\/book\.json$/i,
    );
    if (externalBookMatch) {
      externalBooks.push({
        entry,
        book: externalBookMatch[2],
        path: entry.name,
      });
      continue;
    }
    const externalMatch = entry.name.match(
      /^((?:overrides\/|minecraft\/|\.minecraft\/)?patchouli_books\/)([^/]+)\/([^/]+)\/(categories|entries|templates)\/(.+\.json)$/i,
    );
    if (!externalMatch) continue;
    candidates.push({
      entry,
      namespace: "patchouli",
      book: externalMatch[2],
      locale: externalMatch[3].toLowerCase(),
      section: externalMatch[4].toLowerCase(),
      relativePath: externalMatch[5],
      path: entry.name,
      root: externalMatch[1],
      requiresInstanceInstall: true,
      groupKey: `instance\u0000${externalMatch[1]}\u0000${externalMatch[2]}\u0000${externalMatch[4]}\u0000${externalMatch[5]}`,
    });
  }

  const groups = new Map();
  for (const candidate of candidates) {
    if (!groups.has(candidate.groupKey)) groups.set(candidate.groupKey, []);
    groups.get(candidate.groupKey).push(candidate);
  }

  const documents = [];
  for (const candidatesForFile of groups.values()) {
    const source = chooseLocaleDocument(candidatesForFile, targetLocale);
    if (!source || source.locale === targetLocale) continue;
    const target = candidatesForFile.find(
      (candidate) => candidate.locale === targetLocale,
    );
    try {
      const parsed = await readJsonDocument(source.entry, readText);
      const records = collectJsonRecords(parsed.data, {
        fields: PATCHOULI_FIELDS,
        skipLocalizationKeys: true,
      });
      if (!records.length) continue;
      let targetRecords = [];
      if (target) {
        const parsedTarget = await readJsonDocument(target.entry, readText);
        targetRecords = collectJsonRecords(parsedTarget.data, {
          fields: PATCHOULI_FIELDS,
          skipLocalizationKeys: false,
        });
      }
      const outputPath = `${source.root}${source.book}/${targetLocale}/${source.section}/${source.relativePath}`;
      documents.push({
        id: `patchouli:${outputPath}`,
        kind: "patchouli",
        label: "Patchouli",
        namespaceId: source.namespace,
        namespace: `Patchouli · ${source.namespace}/${source.book}/${source.section}/${source.relativePath}`,
        format: "patchouli-json",
        sourceLocale: source.locale,
        sourcePath: source.path,
        existingTargetPath: target?.path || "",
        outputPath,
        installPath: source.requiresInstanceInstall
          ? normalizeInstancePath(outputPath)
          : undefined,
        requiresInstanceInstall: source.requiresInstanceInstall,
        sourceText: parsed.sourceText,
        template: parsed.data,
        records: attachExistingTargets(records, targetRecords),
      });
    } catch (error) {
      warnings.push(`${source.path}: ${error.message}`);
    }
  }
  for (const source of externalBooks) {
    try {
      const parsed = await readJsonDocument(source.entry, readText);
      const records = collectJsonRecords(parsed.data, {
        fields: PATCHOULI_FIELDS,
        skipLocalizationKeys: true,
      });
      if (!records.length) continue;
      documents.push({
        id: `patchouli-book:${source.path}`,
        kind: "patchouli",
        label: "Patchouli",
        namespaceId: "patchouli",
        namespace: `Patchouli · ${source.book}/book.json`,
        format: "patchouli-json",
        sourceLocale: "en_us",
        sourcePath: source.path,
        existingTargetPath: "",
        outputPath: source.path,
        installPath: normalizeInstancePath(source.path),
        requiresInstanceInstall: true,
        sourceText: parsed.sourceText,
        template: parsed.data,
        records,
      });
    } catch (error) {
      warnings.push(`${source.path}: ${error.message}`);
    }
  }
  return { documents, warnings };
}

function modernFtbLangMatch(path) {
  return path.match(
    /^(.*(?:config|defaultconfigs)\/ftbquests\/quests\/lang\/)([^/]+)\.snbt$/i,
  );
}

async function extractModernFtbDocuments(
  archiveEntries,
  { readText, targetLocale },
) {
  const warnings = [];
  const candidates = [];
  for (const entry of archiveEntries) {
    if (entry.dir) continue;
    const match = modernFtbLangMatch(entry.name);
    if (!match) continue;
    candidates.push({
      entry,
      root: match[1],
      locale: match[2].toLowerCase(),
      path: entry.name,
    });
  }
  const groups = new Map();
  for (const candidate of candidates) {
    if (!groups.has(candidate.root)) groups.set(candidate.root, []);
    groups.get(candidate.root).push(candidate);
  }

  const documents = [];
  for (const candidatesForRoot of groups.values()) {
    const source = chooseLocaleDocument(candidatesForRoot, targetLocale);
    if (!source || source.locale === targetLocale) continue;
    const target = candidatesForRoot.find(
      (candidate) => candidate.locale === targetLocale,
    );
    try {
      const sourceText = await readText(source.entry, source.path);
      const parsed = collectSnbtRecords(sourceText, "all");
      if (!parsed.records.length) continue;
      let targetRecords = [];
      if (target) {
        const targetText = await readText(target.entry, target.path);
        targetRecords = collectSnbtRecords(targetText, "all").records;
      }
      const outputPath = `${source.root}${targetLocale}.snbt`;
      documents.push({
        id: `ftbquests:${outputPath}`,
        kind: "ftbquests",
        label: "FTB Quests",
        namespaceId: "ftbquests",
        namespace: `FTB Quests · lang/${source.locale}.snbt`,
        format: "ftbquests-lang-snbt",
        sourceLocale: source.locale,
        sourcePath: source.path,
        existingTargetPath: target?.path || "",
        outputPath,
        installPath: normalizeInstancePath(outputPath),
        requiresInstanceInstall: true,
        sourceText,
        tokens: parsed.tokens,
        records: attachExistingTargets(parsed.records, targetRecords),
      });
    } catch (error) {
      warnings.push(`${source.path}: ${error.message}`);
    }
  }
  return { documents, warnings };
}

async function extractLegacyFtbDocuments(
  archiveEntries,
  { readText, modernDocuments },
) {
  const warnings = [];
  const documents = [];
  const hasModernTranslations = modernDocuments.length > 0;
  if (hasModernTranslations) return { documents, warnings };

  for (const entry of archiveEntries) {
    if (
      entry.dir ||
      !/(?:^|\/)(?:config|defaultconfigs)\/ftbquests\/quests\/(?!lang\/).+\.snbt$/i.test(
        entry.name,
      )
    ) {
      continue;
    }
    try {
      const sourceText = await readText(entry, entry.name);
      const parsed = collectSnbtRecords(sourceText, "quest-fields");
      if (!parsed.records.length) continue;
      documents.push({
        id: `ftbquests-legacy:${entry.name}`,
        kind: "ftbquests",
        label: "FTB Quests",
        namespaceId: "ftbquests",
        namespace: `FTB Quests · ${entry.name}`,
        format: "ftbquests-legacy-snbt",
        sourceLocale: "en_us",
        sourcePath: entry.name,
        existingTargetPath: "",
        outputPath: entry.name,
        installPath: normalizeInstancePath(entry.name),
        requiresInstanceInstall: true,
        sourceText,
        tokens: parsed.tokens,
        records: parsed.records,
      });
    } catch (error) {
      warnings.push(`${entry.name}: ${error.message}`);
    }
  }
  return { documents, warnings };
}

function isBetterQuestingPath(path) {
  return (
    /(?:^|\/)config\/betterquesting\/.+\.json$/i.test(path) &&
    /(?:quest|database)/i.test(path.split("/").at(-1))
  );
}

async function extractBetterQuestingDocuments(archiveEntries, { readText }) {
  const warnings = [];
  const documents = [];
  for (const entry of archiveEntries) {
    if (entry.dir || !isBetterQuestingPath(entry.name)) continue;
    try {
      const parsed = await readJsonDocument(entry, readText);
      const records = collectJsonRecords(parsed.data, {
        fields: QUEST_FIELDS,
        skipLocalizationKeys: true,
      });
      if (!records.length) continue;
      documents.push({
        id: `betterquesting:${entry.name}`,
        kind: "betterquesting",
        label: "Better Questing",
        namespaceId: "betterquesting",
        namespace: `Better Questing · ${entry.name}`,
        format: "betterquesting-json",
        sourceLocale: "en_us",
        sourcePath: entry.name,
        existingTargetPath: "",
        outputPath: entry.name,
        installPath: normalizeInstancePath(entry.name),
        requiresInstanceInstall: true,
        sourceText: parsed.sourceText,
        template: parsed.data,
        records,
      });
    } catch (error) {
      warnings.push(`${entry.name}: ${error.message}`);
    }
  }
  return { documents, warnings };
}

function collectNbtQuestRecords(document) {
  const records = [];

  const addStringRecord = (value, locatorPath, visiblePath, fieldName) => {
    if (
      !QUEST_FIELDS.has(normalizedFieldName(fieldName)) ||
      !isTranslatableString(value, { skipLocalizationKeys: true })
    ) {
      return;
    }
    const rawJson = collectRawJsonText(value);
    if (rawJson) {
      for (const component of rawJson.records) {
        records.push({
          key: `${pathKey(locatorPath)}#${pathKey(component.path)}`,
          displayKey: `${displayPath(visiblePath)} · ${displayPath(component.path)}`,
          source: component.source,
          locator: {
            type: "nbt",
            path: locatorPath,
            jsonPath: component.path,
          },
        });
      }
      return;
    }
    records.push({
      key: pathKey(locatorPath),
      displayKey: displayPath(visiblePath),
      source: value,
      locator: {
        type: "nbt",
        path: locatorPath,
        jsonPath: null,
      },
    });
  };

  const visit = (type, value, locatorPath, visiblePath, fieldName) => {
    if (type === NBT_TAG.STRING) {
      addStringRecord(value, locatorPath, visiblePath, fieldName);
      return;
    }
    if (type === NBT_TAG.COMPOUND) {
      value.forEach((child, index) =>
        visit(
          child.type,
          child.value,
          [...locatorPath, { kind: "compound", index }],
          [...visiblePath, child.name],
          child.name,
        ),
      );
      return;
    }
    if (type === NBT_TAG.LIST) {
      value.items.forEach((item, index) =>
        visit(
          value.elementType,
          item,
          [...locatorPath, { kind: "list", index }],
          [...visiblePath, index],
          fieldName,
        ),
      );
    }
  };

  visit(
    document.root.type,
    document.root.value,
    [],
    document.root.name ? [document.root.name] : [],
    document.root.name,
  );
  return records;
}

function nbtStringReference(root, path) {
  let type = root.type;
  let value = root.value;
  let setValue = (replacement) => {
    root.value = replacement;
  };

  for (const step of path) {
    if (step.kind === "compound") {
      if (type !== NBT_TAG.COMPOUND || !value[step.index]) {
        throw new Error("NBT文字列の参照先が見つかりません。");
      }
      const child = value[step.index];
      type = child.type;
      value = child.value;
      setValue = (replacement) => {
        child.value = replacement;
      };
      continue;
    }
    if (step.kind === "list") {
      if (
        type !== NBT_TAG.LIST ||
        step.index < 0 ||
        step.index >= value.items.length
      ) {
        throw new Error("NBT文字列の参照先が見つかりません。");
      }
      const list = value;
      type = list.elementType;
      value = list.items[step.index];
      setValue = (replacement) => {
        list.items[step.index] = replacement;
      };
      continue;
    }
    throw new Error("NBT文字列の参照形式が不正です。");
  }
  if (type !== NBT_TAG.STRING) {
    throw new Error("NBTの翻訳対象がTAG_Stringではありません。");
  }
  return { value, setValue };
}

async function extractBinaryFtbDocuments(archiveEntries, { readBytes }) {
  const warnings = [];
  const documents = [];
  if (!readBytes) return { documents, warnings };

  for (const entry of archiveEntries) {
    if (
      entry.dir ||
      !/(?:^|\/)(?:config|defaultconfigs)\/ftbquests\/quests\/(?!lang\/).+\.nbt$/i.test(
        entry.name,
      )
    ) {
      continue;
    }
    try {
      const bytes = await readBytes(entry, entry.name);
      const nbtDocument = parseNbt(bytes);
      const records = collectNbtQuestRecords(nbtDocument);
      if (!records.length) continue;
      documents.push({
        id: `ftbquests-binary:${entry.name}`,
        kind: "ftbquests",
        label: "FTB Quests",
        namespaceId: "ftbquests",
        namespace: `FTB Quests · ${entry.name}`,
        format: "ftbquests-binary-nbt",
        sourceLocale: "en_us",
        sourcePath: entry.name,
        existingTargetPath: "",
        outputPath: entry.name,
        installPath: normalizeInstancePath(entry.name),
        requiresInstanceInstall: true,
        nbtDocument,
        records,
      });
    } catch (error) {
      warnings.push(`${entry.name}: ${error.message}`);
    }
  }
  return { documents, warnings };
}

function normalizeInstancePath(path) {
  return String(path)
    .replace(/^(?:overrides|minecraft|\.minecraft)\//i, "")
    .replace(/^\/+/, "");
}

export async function extractMinecraftContentDocuments(
  archiveEntries,
  { readText, readBytes, targetLocale },
) {
  const patchouli = await extractPatchouliDocuments(archiveEntries, {
    readText,
    targetLocale,
  });
  const modernFtb = await extractModernFtbDocuments(archiveEntries, {
    readText,
    targetLocale,
  });
  const legacyFtb = await extractLegacyFtbDocuments(archiveEntries, {
    readText,
    modernDocuments: modernFtb.documents,
  });
  const betterQuesting = await extractBetterQuestingDocuments(archiveEntries, {
    readText,
  });
  const binaryFtb = await extractBinaryFtbDocuments(archiveEntries, {
    readBytes,
  });
  const warnings = [
    ...patchouli.warnings,
    ...modernFtb.warnings,
    ...legacyFtb.warnings,
    ...betterQuesting.warnings,
    ...binaryFtb.warnings,
  ];
  const documents = [
    ...patchouli.documents,
    ...modernFtb.documents,
    ...legacyFtb.documents,
    ...betterQuesting.documents,
    ...binaryFtb.documents,
  ];
  return {
    documents,
    warnings,
    kinds: [...new Set(documents.map((document) => document.kind))],
    requiresInstanceInstall: documents.some(
      (document) => document.requiresInstanceInstall,
    ),
  };
}

export function renderMinecraftContentDocument(
  document,
  entriesById,
  shouldInclude,
) {
  const resolveValue = (record) => {
    const entry = entriesById.get(record.entryId);
    if (entry && shouldInclude(entry)) return entry.translation;
    return record.existingTarget ?? record.source;
  };

  if (
    document.format === "patchouli-json" ||
    document.format === "betterquesting-json"
  ) {
    const output = deepClone(document.template);
    for (const record of document.records) {
      setValueAtPath(output, record.locator.path, resolveValue(record));
    }
    return `${JSON.stringify(output, null, 2)}\n`;
  }
  if (
    document.format === "ftbquests-lang-snbt" ||
    document.format === "ftbquests-legacy-snbt"
  ) {
    return replaceSnbtValues(document, document.records, resolveValue);
  }
  if (document.format === "ftbquests-binary-nbt") {
    const output = cloneNbtDocument(document.nbtDocument);
    const componentGroups = new Map();
    for (const record of document.records) {
      const value = resolveValue(record);
      if (value === undefined) continue;
      if (!record.locator.jsonPath) {
        nbtStringReference(output.root, record.locator.path).setValue(value);
        continue;
      }
      const key = pathKey(record.locator.path);
      if (!componentGroups.has(key)) {
        componentGroups.set(key, {
          path: record.locator.path,
          replacements: [],
        });
      }
      componentGroups.get(key).replacements.push({
        path: record.locator.jsonPath,
        value,
      });
    }
    for (const group of componentGroups.values()) {
      const reference = nbtStringReference(output.root, group.path);
      try {
        const component = JSON.parse(reference.value);
        group.replacements.forEach(({ path, value }) =>
          setValueAtPath(component, path, value),
        );
        reference.setValue(JSON.stringify(component));
      } catch {
        // Invalid components remain byte-for-byte equivalent to the source value.
      }
    }
    return writeNbt(output);
  }
  throw new Error(`未対応のMinecraft拡張形式です: ${document.format}`);
}
