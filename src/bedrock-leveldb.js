import { readLevelDb } from "mcbe-leveldb-reader";

import {
  NBT_TAG,
  cloneNbtDocument,
  decodeNbtSequence,
  encodeNbtSequence,
} from "./nbt.js";

const LOG_BLOCK_BYTES = 32 * 1024;
const LOG_HEADER_BYTES = 7;
const MAX_DB_BYTES = 256 * 1024 * 1024;
const MAX_PATCH_BYTES = 64 * 1024 * 1024;
const MAX_PATCH_RECORDS = 20_000;
const BEDROCK_NBT_OPTIONS = Object.freeze({
  littleEndian: true,
  stringEncoding: "utf8",
});
const VISIBLE_STRING_NAMES = /^(?:Text|CustomName|RawtextName|InteractiveText|InterativeText|FilteredText|title|filtered_title|ButtonName|button_name|NameTag)$/i;
const VISIBLE_LIST_NAMES = /^(?:Pages|pages|Lore|Messages|messages)$/i;

function concatBytes(parts) {
  const length = parts.reduce((total, part) => total + part.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function encodeVarint(value) {
  let remaining = BigInt(value);
  if (remaining < 0n) throw new Error("LevelDB varintに負数は使用できません。");
  const output = [];
  do {
    let byte = Number(remaining & 0x7fn);
    remaining >>= 7n;
    if (remaining) byte |= 0x80;
    output.push(byte);
  } while (remaining);
  return new Uint8Array(output);
}

function decodeVarint(bytes, start) {
  let value = 0n;
  let shift = 0n;
  let offset = start;
  while (offset < bytes.length && shift <= 63n) {
    const byte = bytes[offset++];
    value |= BigInt(byte & 0x7f) << shift;
    if (!(byte & 0x80)) return { value, offset };
    shift += 7n;
  }
  throw new Error("LevelDB varintが不正です。");
}

function readLengthPrefixed(bytes, start) {
  const length = decodeVarint(bytes, start);
  if (length.value > BigInt(bytes.length)) {
    throw new Error("LevelDBの長さ指定が大きすぎます。");
  }
  const end = length.offset + Number(length.value);
  if (end > bytes.length) throw new Error("LevelDBレコードが途中で終了しています。");
  return { value: bytes.slice(length.offset, end), offset: end };
}

let crcTable;
function crc32c(bytes) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let index = 0; index < 256; index += 1) {
      let value = index;
      for (let bit = 0; bit < 8; bit += 1) {
        value = value & 1 ? (value >>> 1) ^ 0x82f63b78 : value >>> 1;
      }
      crcTable[index] = value >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function maskCrc(crc) {
  return ((((crc >>> 15) | (crc << 17)) >>> 0) + 0xa282ead8) >>> 0;
}

function physicalLogRecords(bytes, { verifyChecksums = true } = {}) {
  const records = [];
  let fragments = [];
  let offset = 0;
  while (offset < bytes.length) {
    const blockOffset = offset % LOG_BLOCK_BYTES;
    const remaining = LOG_BLOCK_BYTES - blockOffset;
    if (remaining < LOG_HEADER_BYTES) {
      for (const byte of bytes.subarray(offset, offset + remaining)) {
        if (byte !== 0) throw new Error("LevelDBログのパディングが不正です。");
      }
      offset += remaining;
      continue;
    }
    if (bytes.length - offset < LOG_HEADER_BYTES) break;
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset, LOG_HEADER_BYTES);
    const checksum = view.getUint32(0, true);
    const length = view.getUint16(4, true);
    const type = view.getUint8(6);
    if (!checksum && !length && !type) {
      offset += remaining;
      continue;
    }
    if (length > remaining - LOG_HEADER_BYTES || offset + LOG_HEADER_BYTES + length > bytes.length) {
      throw new Error("LevelDBログレコードの長さが不正です。");
    }
    if (type < 1 || type > 4) throw new Error("LevelDBログレコード種別が不正です。");
    const payload = bytes.slice(offset + LOG_HEADER_BYTES, offset + LOG_HEADER_BYTES + length);
    if (verifyChecksums) {
      const actual = maskCrc(crc32c(concatBytes([new Uint8Array([type]), payload])));
      if (actual !== checksum) throw new Error("LevelDBログのチェックサムが一致しません。");
    }
    if (type === 1) {
      if (fragments.length) throw new Error("LevelDBログの断片順序が不正です。");
      records.push(payload);
    } else if (type === 2) {
      if (fragments.length) throw new Error("LevelDBログの断片開始が重複しています。");
      fragments = [payload];
    } else if (type === 3) {
      if (!fragments.length) throw new Error("LevelDBログの断片開始がありません。");
      fragments.push(payload);
    } else {
      if (!fragments.length) throw new Error("LevelDBログの断片開始がありません。");
      fragments.push(payload);
      records.push(concatBytes(fragments));
      fragments = [];
    }
    offset += LOG_HEADER_BYTES + length;
  }
  if (fragments.length) throw new Error("LevelDBログが途中で終了しています。");
  return records;
}

function parseManifest(bytes) {
  let logNumber = 0n;
  let previousLogNumber = 0n;
  let nextFileNumber = 0n;
  let lastSequence = 0n;
  for (const record of physicalLogRecords(bytes)) {
    let offset = 0;
    while (offset < record.length) {
      const tag = decodeVarint(record, offset);
      offset = tag.offset;
      if (tag.value === 1n) {
        offset = readLengthPrefixed(record, offset).offset;
      } else if ([2n, 3n, 4n, 9n].includes(tag.value)) {
        const field = decodeVarint(record, offset);
        offset = field.offset;
        if (tag.value === 2n) logNumber = field.value;
        if (tag.value === 3n) nextFileNumber = field.value;
        if (tag.value === 4n) lastSequence = field.value;
        if (tag.value === 9n) previousLogNumber = field.value;
      } else if (tag.value === 5n) {
        offset = decodeVarint(record, offset).offset;
        offset = readLengthPrefixed(record, offset).offset;
      } else if (tag.value === 6n) {
        offset = decodeVarint(record, offset).offset;
        offset = decodeVarint(record, offset).offset;
      } else if (tag.value === 7n) {
        offset = decodeVarint(record, offset).offset;
        offset = decodeVarint(record, offset).offset;
        offset = decodeVarint(record, offset).offset;
        offset = readLengthPrefixed(record, offset).offset;
        offset = readLengthPrefixed(record, offset).offset;
      } else {
        throw new Error(`未対応のLevelDB Manifestタグです: ${tag.value}`);
      }
    }
  }
  if (!nextFileNumber) throw new Error("LevelDB Manifestに次のファイル番号がありません。");
  if (!logNumber) throw new Error("LevelDB Manifestにログ番号がありません。");
  return { logNumber, previousLogNumber, nextFileNumber, lastSequence };
}

function writeFixed64(value) {
  const output = new Uint8Array(8);
  new DataView(output.buffer).setBigUint64(0, BigInt(value), true);
  return output;
}

function writeFixed32(value) {
  const output = new Uint8Array(4);
  new DataView(output.buffer).setUint32(0, Number(value), true);
  return output;
}

function encodePhysicalLog(record) {
  const output = [];
  let outputLength = 0;
  let offset = 0;
  let first = true;
  while (offset < record.length || (first && !record.length)) {
    const blockOffset = outputLength % LOG_BLOCK_BYTES;
    const remaining = LOG_BLOCK_BYTES - blockOffset;
    if (remaining < LOG_HEADER_BYTES) {
      output.push(new Uint8Array(remaining));
      outputLength += remaining;
      continue;
    }
    const available = remaining - LOG_HEADER_BYTES;
    const length = Math.min(available, record.length - offset);
    const last = offset + length >= record.length;
    const type = first && last ? 1 : first ? 2 : last ? 4 : 3;
    const payload = record.slice(offset, offset + length);
    const header = new Uint8Array(LOG_HEADER_BYTES);
    const view = new DataView(header.buffer);
    view.setUint32(0, maskCrc(crc32c(concatBytes([new Uint8Array([type]), payload]))), true);
    view.setUint16(4, length, true);
    view.setUint8(6, type);
    output.push(header, payload);
    outputLength += header.length + payload.length;
    offset += length;
    first = false;
  }
  return concatBytes(output);
}

export function buildLevelDbManifestLog({ logNumber, nextFileNumber, lastSequence }) {
  return encodePhysicalLog(concatBytes([
    encodeVarint(2),
    encodeVarint(logNumber),
    encodeVarint(3),
    encodeVarint(nextFileNumber),
    encodeVarint(4),
    encodeVarint(lastSequence),
  ]));
}

export function buildLevelDbWriteLog(updates, sequence, { allowDeletes = false } = {}) {
  if (!Array.isArray(updates) || !updates.length) throw new Error("LevelDB更新内容がありません。");
  if (updates.length > MAX_PATCH_RECORDS) throw new Error("LevelDBの更新件数が多すぎます。");
  const records = [writeFixed64(sequence), writeFixed32(updates.length)];
  let total = 12;
  for (const update of updates) {
    const key = new Uint8Array(update.key);
    const deleted = update.deleted === true;
    if (deleted && !allowDeletes) {
      throw new Error("LevelDB削除操作は翻訳パッチに使用できません。");
    }
    const value = deleted ? null : new Uint8Array(update.value);
    total += 1 + key.length + (value?.length || 0);
    if (total > MAX_PATCH_BYTES) throw new Error("LevelDB翻訳パッチが大きすぎます。");
    records.push(
      new Uint8Array([deleted ? 0 : 1]),
      encodeVarint(key.length),
      key,
    );
    if (value) records.push(encodeVarint(value.length), value);
  }
  const output = encodePhysicalLog(concatBytes(records));
  decodeLevelDbWriteLog(output, { allowDeletes });
  return output;
}

export function decodeLevelDbWriteLog(bytes, { allowDeletes = true } = {}) {
  const logical = physicalLogRecords(new Uint8Array(bytes));
  const updates = [];
  for (const record of logical) {
    if (record.length < 12) throw new Error("LevelDB WriteBatchが短すぎます。");
    const view = new DataView(record.buffer, record.byteOffset, record.byteLength);
    const sequence = view.getBigUint64(0, true);
    const count = view.getUint32(8, true);
    let offset = 12;
    for (let index = 0; index < count; index += 1) {
      const operation = record[offset++];
      if (operation !== 0 && operation !== 1) {
        throw new Error("LevelDB WriteBatchの操作種別が不正です。");
      }
      const key = readLengthPrefixed(record, offset);
      offset = key.offset;
      if (operation === 0) {
        if (!allowDeletes) {
          throw new Error("LevelDB削除操作は翻訳パッチに使用できません。");
        }
        updates.push({
          sequence: sequence + BigInt(index),
          key: key.value,
          value: null,
          deleted: true,
        });
        continue;
      }
      const value = readLengthPrefixed(record, offset);
      offset = value.offset;
      updates.push({
        sequence: sequence + BigInt(index),
        key: key.value,
        value: value.value,
        deleted: false,
      });
    }
    if (offset !== record.length) throw new Error("LevelDB WriteBatchの末尾に余分なデータがあります。");
  }
  return updates;
}

function jsonVisibleStrings(value, path = [], records = []) {
  if (typeof value === "string") {
    if (/\p{L}/u.test(value)) records.push({ source: value, jsonPath: path });
    return records;
  }
  if (Array.isArray(value)) {
    value.forEach((child, index) => jsonVisibleStrings(child, [...path, index], records));
    return records;
  }
  if (!value || typeof value !== "object") return records;
  for (const [key, child] of Object.entries(value)) {
    if (["text", "title", "name", "button_name", "body"].includes(key)) {
      jsonVisibleStrings(child, [...path, key], records);
    } else if (["rawtext", "extra", "with", "buttons"].includes(key)) {
      jsonVisibleStrings(child, [...path, key], records);
    }
  }
  return records;
}

function decodeVisibleValue(value) {
  const source = String(value ?? "");
  if (!source.trim() || !/\p{L}/u.test(source)) return [];
  try {
    const parsed = JSON.parse(source);
    const records = jsonVisibleStrings(parsed);
    return records.map((record) => ({ ...record, encoding: "json" }));
  } catch {
    return [{ source, jsonPath: null, encoding: "plain" }];
  }
}

function collectVisibleNbtText(root, rootIndex) {
  const records = [];
  const visit = (type, value, path, parentName = "") => {
    if (type === NBT_TAG.COMPOUND) {
      value.forEach((tag, index) => {
        const childPath = [...path, { kind: "compound", index }];
        if (tag.type === NBT_TAG.STRING && VISIBLE_STRING_NAMES.test(tag.name)) {
          for (const decoded of decodeVisibleValue(tag.value)) {
            records.push({
              displayKey: `leveldb.${rootIndex}.${tag.name}.${records.length + 1}`,
              source: decoded.source,
              locator: {
                rootIndex,
                nbtPath: childPath,
                jsonPath: decoded.jsonPath,
                encoding: decoded.encoding,
              },
            });
          }
        } else {
          visit(tag.type, tag.value, childPath, tag.name);
        }
      });
    } else if (type === NBT_TAG.LIST) {
      value.items.forEach((item, index) => {
        const childPath = [...path, { kind: "list", index }];
        if (value.elementType === NBT_TAG.STRING && VISIBLE_LIST_NAMES.test(parentName)) {
          for (const decoded of decodeVisibleValue(item)) {
            records.push({
              displayKey: `leveldb.${rootIndex}.${parentName}.${index + 1}`,
              source: decoded.source,
              locator: {
                rootIndex,
                nbtPath: childPath,
                jsonPath: decoded.jsonPath,
                encoding: decoded.encoding,
              },
            });
          }
        } else {
          visit(value.elementType, item, childPath, parentName);
        }
      });
    }
  };
  visit(root.type, root.value, []);
  return records;
}

function isCandidateKey(key) {
  const startsWith = (prefix) => {
    const encoded = new TextEncoder().encode(prefix);
    return encoded.every((byte, index) => key[index] === byte);
  };
  return startsWith("actorprefix") ||
    startsWith("~local_player") ||
    startsWith("player_server_") ||
    key.at(-1) === 0x31;
}

function bytesToHex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function nbtStringReference(root, path) {
  let type = root.type;
  let value = root.value;
  let parent;
  let parentKey;
  for (const step of path) {
    if (step.kind === "compound") {
      if (type !== NBT_TAG.COMPOUND || !value[step.index]) throw new Error("Bedrock NBT参照が不正です。");
      parent = value;
      parentKey = step.index;
      type = value[step.index].type;
      value = value[step.index].value;
    } else {
      if (type !== NBT_TAG.LIST || !value.items || step.index >= value.items.length) {
        throw new Error("Bedrock NBTリスト参照が不正です。");
      }
      parent = value.items;
      parentKey = step.index;
      type = value.elementType;
      value = value.items[step.index];
    }
  }
  if (type !== NBT_TAG.STRING) throw new Error("Bedrock NBT参照先が文字列ではありません。");
  return {
    value,
    setValue(next) {
      if (Array.isArray(parent) && parent[parentKey]?.type === NBT_TAG.STRING) {
        parent[parentKey].value = next;
      } else {
        parent[parentKey] = next;
      }
    },
  };
}

function setJsonPath(root, path, value) {
  if (!path.length) return value;
  let current = root;
  for (let index = 0; index < path.length - 1; index += 1) current = current[path[index]];
  current[path.at(-1)] = value;
  return root;
}

function renderDocumentValue(document, entriesById, includeEntry) {
  const roots = document.levelDbRoots.map((root) => cloneNbtDocument({
    root,
    compression: "raw",
    endian: "little",
    stringEncoding: "utf8",
  }).root);
  const jsonGroups = new Map();
  for (const record of document.records) {
    const entry = entriesById.get(record.entryId);
    if (!entry || !includeEntry(entry)) continue;
    const root = roots[record.locator.rootIndex];
    const reference = nbtStringReference(root, record.locator.nbtPath);
    if (record.locator.encoding === "plain") {
      reference.setValue(entry.translation);
      continue;
    }
    const key = `${record.locator.rootIndex}:${JSON.stringify(record.locator.nbtPath)}`;
    if (!jsonGroups.has(key)) jsonGroups.set(key, { reference, replacements: [] });
    jsonGroups.get(key).replacements.push({
      path: record.locator.jsonPath,
      translation: entry.translation,
    });
  }
  for (const group of jsonGroups.values()) {
    let parsed = JSON.parse(group.reference.value);
    for (const replacement of group.replacements) {
      parsed = setJsonPath(parsed, replacement.path, replacement.translation);
    }
    group.reference.setValue(JSON.stringify(parsed));
  }
  return encodeNbtSequence(roots, BEDROCK_NBT_OPTIONS);
}

export async function extractBedrockLevelDbDocuments(entries, { readBytes } = {}) {
  const warnings = [];
  const files = entries.filter((entry) => !entry.dir && /(?:^|\/)db\/[^/]+$/i.test(entry.name));
  const currentEntry = files.find((entry) => /(?:^|\/)db\/CURRENT$/i.test(entry.name));
  if (!currentEntry) return { documents: [], warnings, metadata: null };
  const dbPrefix = currentEntry.name.slice(0, -"CURRENT".length);
  const selected = files.filter((entry) => entry.name.startsWith(dbPrefix));
  let totalBytes = 0;
  const loaded = [];
  for (const entry of selected) {
    const bytes = await readBytes(entry, entry.name, MAX_DB_BYTES);
    totalBytes += bytes.length;
    if (totalBytes > MAX_DB_BYTES) throw new Error("Bedrock LevelDBの合計サイズが大きすぎます。");
    loaded.push({ entry, bytes });
  }
  const currentBytes = loaded.find((item) => item.entry === currentEntry)?.bytes;
  const manifestName = new TextDecoder().decode(currentBytes).trim();
  if (!/^MANIFEST-\d+$/.test(manifestName)) throw new Error("Bedrock LevelDBのCURRENTが不正です。");
  const manifestFile = loaded.find((item) => item.entry.name === `${dbPrefix}${manifestName}`);
  if (!manifestFile) throw new Error("Bedrock LevelDBのManifestが見つかりません。");
  const manifest = parseManifest(manifestFile.bytes);
  const numericFiles = loaded
    .map((item) => item.entry.name.slice(dbPrefix.length).match(/^(\d+)\.(?:ldb|log)$/)?.[1])
    .filter(Boolean)
    .map((value) => BigInt(value));
  const maxExisting = numericFiles.reduce((max, value) => value > max ? value : max, 0n);
  const nextFileNumber = manifest.nextFileNumber > maxExisting
    ? manifest.nextFileNumber
    : maxExisting + 1n;
  const activeLogs = loaded.filter((item) => {
    const match = item.entry.name.slice(dbPrefix.length).match(/^(\d+)\.log$/i);
    if (!match) return false;
    const number = BigInt(match[1]);
    return number >= manifest.logNumber || number === manifest.previousLogNumber;
  });
  let maxSequence = manifest.lastSequence;
  for (const item of activeLogs) {
    for (const update of decodeLevelDbWriteLog(item.bytes)) {
      if (update.sequence > maxSequence) maxSequence = update.sequence;
    }
  }
  const activeLogNames = new Set(activeLogs.map((item) => item.entry.name));
  const dbFiles = loaded
    .filter((item) => {
      const name = item.entry.name.slice(dbPrefix.length);
      return name === manifestName || /\.ldb$/i.test(name) || activeLogNames.has(item.entry.name);
    })
    .map((item) => {
      const bytes = item.bytes;
      return {
        name: item.entry.name.slice(dbPrefix.length),
        arrayBuffer: async () => bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ),
      };
    });
  const levelDb = await readLevelDb(dbFiles);
  const documents = [];
  for (const record of Object.values(levelDb)) {
    if (!record || !record.keyBytes || !record.value) continue;
    const key = new Uint8Array(record.keyBytes);
    if (!isCandidateKey(key)) continue;
    const value = new Uint8Array(record.value);
    try {
      const roots = decodeNbtSequence(value, BEDROCK_NBT_OPTIONS);
      const records = roots.flatMap((root, rootIndex) => collectVisibleNbtText(root, rootIndex));
      if (!records.length) continue;
      documents.push({
        id: `bedrock-leveldb:${bytesToHex(key)}`,
        containerId: "root",
        format: "bedrock-leveldb-nbt",
        sourcePath: `${dbPrefix}${bytesToHex(key)}`,
        outputPath: "",
        sourceLocale: "en_us",
        namespace: `Bedrock World · ${key.at(-1) === 0x31 ? "Block entities" : "Actors"}`,
        levelDbKey: key,
        levelDbRoots: roots,
        records,
      });
    } catch {
      // Candidate records can use non-NBT encodings. Preserve them unchanged.
    }
  }
  return {
    documents,
    warnings,
    metadata: {
      dbPrefix,
      nextFileNumber: nextFileNumber.toString(),
      nextSequence: (maxSequence + 1n).toString(),
    },
  };
}

export function buildBedrockLevelDbPatch(project, entriesById, includeEntry) {
  const metadata = project.artifactState?.levelDb;
  if (!metadata) return null;
  const updates = [];
  for (const document of (project.documents || []).filter(
    (item) => item.format === "bedrock-leveldb-nbt",
  )) {
    const hasOutput = document.records.some((record) => {
      const entry = entriesById.get(record.entryId);
      return entry && includeEntry(entry);
    });
    if (!hasOutput) continue;
    updates.push({
      key: document.levelDbKey,
      value: renderDocumentValue(document, entriesById, includeEntry),
    });
  }
  if (!updates.length) return null;
  const fileNumber = BigInt(metadata.nextFileNumber);
  const filename = `${fileNumber.toString().padStart(6, "0")}.log`;
  return {
    path: `${metadata.dbPrefix}${filename}`,
    bytes: buildLevelDbWriteLog(updates, BigInt(metadata.nextSequence)),
    updates: updates.length,
  };
}
