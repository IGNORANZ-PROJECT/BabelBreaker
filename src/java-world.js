import { cloneNbtDocument, NBT_TAG, parseNbt, writeNbt } from "./nbt.js";

const SECTOR_BYTES = 4096;
const HEADER_BYTES = SECTOR_BYTES * 2;
const MAX_CHUNK_NBT_BYTES = 16 * 1024 * 1024;
const KNOWN_STRING_NAMES = /^(?:Text[1-4]|CustomName|filtered_title|title|raw|filtered)$/i;
const KNOWN_LIST_NAMES = /^(?:messages|filtered_messages|pages|Lore)$/i;
const KNOWN_CONTAINER_NAMES = /^(?:front_text|back_text|written_book_content|writable_book_content|display)$/i;

function readLocation(view, index) {
  const offset = index * 4;
  return {
    sectorOffset: (view.getUint8(offset) << 16) | (view.getUint8(offset + 1) << 8) | view.getUint8(offset + 2),
    sectorCount: view.getUint8(offset + 3),
  };
}

function writeLocation(view, index, sectorOffset, sectorCount) {
  const offset = index * 4;
  view.setUint8(offset, (sectorOffset >>> 16) & 0xff);
  view.setUint8(offset + 1, (sectorOffset >>> 8) & 0xff);
  view.setUint8(offset + 2, sectorOffset & 0xff);
  view.setUint8(offset + 3, sectorCount);
}

function collectJsonText(value, path = [], records = []) {
  if (typeof value === "string") {
    if (/\p{L}/u.test(value)) records.push({ source: value, jsonPath: path });
    return records;
  }
  if (Array.isArray(value)) {
    value.forEach((child, index) => collectJsonText(child, [...path, index], records));
    return records;
  }
  if (!value || typeof value !== "object") return records;
  for (const [key, child] of Object.entries(value)) {
    if (key === "text") collectJsonText(child, [...path, key], records);
    else if (key === "extra" || key === "with") collectJsonText(child, [...path, key], records);
  }
  return records;
}

function decodeVisibleString(raw) {
  const value = String(raw ?? "");
  if (!value.trim() || !/\p{L}/u.test(value)) return [];
  try {
    const parsed = JSON.parse(value);
    const records = collectJsonText(parsed);
    return records.map((record) => ({ ...record, encoding: "json", parsed }));
  } catch {
    return [{ source: value, jsonPath: null, encoding: "plain", parsed: null }];
  }
}

function setJsonPath(root, path, value) {
  if (!path.length) return value;
  let current = root;
  for (let index = 0; index < path.length - 1; index += 1) current = current[path[index]];
  current[path.at(-1)] = value;
  return root;
}

function nbtStringReference(root, path) {
  let type = root.type;
  let value = root.value;
  let parent = null;
  let parentKey = null;
  for (const step of path) {
    if (step.kind === "compound") {
      if (type !== NBT_TAG.COMPOUND || !value[step.index]) throw new Error("NBT参照が不正です。");
      parent = value;
      parentKey = step.index;
      type = value[step.index].type;
      value = value[step.index].value;
    } else {
      if (type !== NBT_TAG.LIST || !value.items || step.index >= value.items.length) throw new Error("NBTリスト参照が不正です。");
      parent = value.items;
      parentKey = step.index;
      type = value.elementType;
      value = value.items[step.index];
    }
  }
  if (type !== NBT_TAG.STRING) throw new Error("NBT参照先が文字列ではありません。");
  return {
    value,
    setValue(next) {
      if (Array.isArray(parent) && parent[parentKey]?.type === NBT_TAG.STRING) parent[parentKey].value = next;
      else parent[parentKey] = next;
    },
  };
}

function collectKnownNbtText(root, chunkIndex) {
  const records = [];
  const visit = (type, value, path, context = { parentName: "", knownContainer: false }) => {
    if (type === NBT_TAG.COMPOUND) {
      value.forEach((tag, index) => {
        const knownContainer = context.knownContainer || KNOWN_CONTAINER_NAMES.test(tag.name);
        const childPath = [...path, { kind: "compound", index }];
        if (tag.type === NBT_TAG.STRING && (KNOWN_STRING_NAMES.test(tag.name) || knownContainer)) {
          for (const decoded of decodeVisibleString(tag.value)) {
            records.push({
              displayKey: `chunk.${chunkIndex}.${tag.name}.${records.length + 1}`,
              source: decoded.source,
              locator: { chunkIndex, nbtPath: childPath, jsonPath: decoded.jsonPath, encoding: decoded.encoding },
            });
          }
        } else {
          visit(tag.type, tag.value, childPath, { parentName: tag.name, knownContainer });
        }
      });
      return;
    }
    if (type === NBT_TAG.LIST) {
      value.items.forEach((item, index) => {
        const childPath = [...path, { kind: "list", index }];
        if (value.elementType === NBT_TAG.STRING && (KNOWN_LIST_NAMES.test(context.parentName) || context.knownContainer)) {
          for (const decoded of decodeVisibleString(item)) {
            records.push({
              displayKey: `chunk.${chunkIndex}.${context.parentName}.${index + 1}.${records.length + 1}`,
              source: decoded.source,
              locator: { chunkIndex, nbtPath: childPath, jsonPath: decoded.jsonPath, encoding: decoded.encoding },
            });
          }
        } else {
          visit(value.elementType, item, childPath, context);
        }
      });
    }
  };
  visit(root.type, root.value, []);
  return records;
}

function parseRegion(bytes, sourcePath) {
  if (bytes.byteLength < HEADER_BYTES) throw new Error("Anvil regionのヘッダーが不足しています。");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const timestamps = bytes.slice(SECTOR_BYTES, HEADER_BYTES);
  const chunks = new Array(1024).fill(null);
  const records = [];
  const warnings = [];

  for (let index = 0; index < 1024; index += 1) {
    const { sectorOffset, sectorCount } = readLocation(view, index);
    if (!sectorOffset || !sectorCount) continue;
    const start = sectorOffset * SECTOR_BYTES;
    const allocated = sectorCount * SECTOR_BYTES;
    if (start < HEADER_BYTES || start + allocated > bytes.byteLength || allocated < 5) {
      warnings.push(`${sourcePath}: chunk ${index} の位置情報が不正です`);
      continue;
    }
    const length = view.getUint32(start, false);
    if (length < 1 || length + 4 > allocated) {
      warnings.push(`${sourcePath}: chunk ${index} の長さが不正です`);
      continue;
    }
    const compressionByte = view.getUint8(start + 4);
    const compression = compressionByte & 0x7f;
    const external = Boolean(compressionByte & 0x80);
    const rawRecord = bytes.slice(start, start + 4 + length);
    const chunk = { index, rawRecord, compressionByte, external, nbtDocument: null, records: [] };
    chunks[index] = chunk;
    if (external || ![1, 2, 3].includes(compression)) continue;
    try {
      const payload = bytes.slice(start + 5, start + 4 + length);
      const nbtDocument = parseNbt(payload, { maxBytes: MAX_CHUNK_NBT_BYTES });
      const chunkRecords = collectKnownNbtText(nbtDocument.root, index);
      if (!chunkRecords.length) continue;
      chunk.nbtDocument = nbtDocument;
      chunk.records = chunkRecords;
      records.push(...chunkRecords);
    } catch (error) {
      warnings.push(`${sourcePath}: chunk ${index} を解析できません: ${error.message}`);
    }
  }
  return { sourcePath, timestamps, chunks, records, warnings };
}

function renderRegion(document, entriesById, includeEntry) {
  const chunkRecords = new Map();
  for (const record of document.records) {
    const entry = entriesById.get(record.entryId);
    if (!entry || !includeEntry(entry)) continue;
    if (!chunkRecords.has(record.locator.chunkIndex)) chunkRecords.set(record.locator.chunkIndex, []);
    chunkRecords.get(record.locator.chunkIndex).push({ record, translation: entry.translation });
  }

  const records = [];
  for (const chunk of document.region.chunks) {
    if (!chunk) {
      records.push(null);
      continue;
    }
    const replacements = chunkRecords.get(chunk.index);
    if (!replacements?.length || !chunk.nbtDocument) {
      records.push(chunk.rawRecord);
      continue;
    }
    const output = cloneNbtDocument(chunk.nbtDocument);
    const jsonGroups = new Map();
    for (const { record, translation } of replacements) {
      const reference = nbtStringReference(output.root, record.locator.nbtPath);
      if (record.locator.encoding === "plain") {
        reference.setValue(translation);
        continue;
      }
      const key = JSON.stringify(record.locator.nbtPath);
      if (!jsonGroups.has(key)) jsonGroups.set(key, { reference, replacements: [] });
      jsonGroups.get(key).replacements.push({ path: record.locator.jsonPath, translation });
    }
    for (const group of jsonGroups.values()) {
      try {
        let parsed = JSON.parse(group.reference.value);
        for (const replacement of group.replacements) parsed = setJsonPath(parsed, replacement.path, replacement.translation);
        group.reference.setValue(JSON.stringify(parsed));
      } catch {
        // Keep an invalid component unchanged.
      }
    }
    const payload = writeNbt(output);
    const raw = new Uint8Array(payload.byteLength + 5);
    const view = new DataView(raw.buffer);
    view.setUint32(0, payload.byteLength + 1, false);
    view.setUint8(4, chunk.compressionByte);
    raw.set(payload, 5);
    records.push(raw);
  }

  let sectors = 2;
  const layouts = records.map((record) => {
    if (!record) return null;
    const count = Math.ceil(record.byteLength / SECTOR_BYTES);
    if (count > 255) throw new Error("Anvil chunkが255セクターを超えています。");
    const layout = { offset: sectors, count, record };
    sectors += count;
    return layout;
  });
  const output = new Uint8Array(sectors * SECTOR_BYTES);
  output.set(document.region.timestamps, SECTOR_BYTES);
  const view = new DataView(output.buffer);
  layouts.forEach((layout, index) => {
    if (!layout) return;
    writeLocation(view, index, layout.offset, layout.count);
    output.set(layout.record, layout.offset * SECTOR_BYTES);
  });
  return output;
}

export async function extractJavaWorldRegionDocuments(entries, { readBytes, maxRegions = 64 } = {}) {
  const documents = [];
  const warnings = [];
  const regions = entries.filter(
    (entry) =>
      !entry.dir &&
      /(?:^|\/)(?:region|entities)\/r\.-?\d+\.-?\d+\.mca$/i.test(entry.name),
  );
  if (regions.length > maxRegions) {
    warnings.push(
      `region・entitiesファイルが${regions.length}個あるため、先頭${maxRegions}個だけを解析します。`,
    );
  }
  for (const entry of regions.slice(0, maxRegions)) {
    try {
      const bytes = await readBytes(entry, entry.name, 64 * 1024 * 1024);
      const region = parseRegion(bytes, entry.name);
      warnings.push(...region.warnings);
      if (!region.records.length) continue;
      documents.push({
        id: `java-region:${entry.name}`,
        kind: "java-world-text",
        label: "Java World Text",
        namespaceId: "java-world",
        namespace: `World · ${entry.name}`,
        format: "java-region-nbt",
        sourceLocale: "en_us",
        sourcePath: entry.name,
        outputPath: entry.name,
        requiresInstanceInstall: false,
        region,
        records: region.records,
      });
    } catch (error) {
      warnings.push(`${entry.name}: ${error.message}`);
    }
  }
  return { documents, warnings };
}

export function renderJavaWorldRegionDocument(document, entriesById, includeEntry) {
  if (document.format !== "java-region-nbt") throw new Error(`未対応のJava World形式です: ${document.format}`);
  return renderRegion(document, entriesById, includeEntry);
}
