import pako from "pako";

export const NBT_TAG = Object.freeze({
  END: 0,
  BYTE: 1,
  SHORT: 2,
  INT: 3,
  LONG: 4,
  FLOAT: 5,
  DOUBLE: 6,
  BYTE_ARRAY: 7,
  STRING: 8,
  LIST: 9,
  COMPOUND: 10,
  INT_ARRAY: 11,
  LONG_ARRAY: 12,
});

const MAX_NBT_DEPTH = 512;
const MAX_NBT_ITEMS = 1_000_000;

function asUint8Array(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  return new Uint8Array(value);
}

function isZlib(bytes) {
  if (bytes.length < 2) return false;
  const header = (bytes[0] << 8) | bytes[1];
  return (bytes[0] & 0x0f) === 8 && header % 31 === 0;
}

function decompressWithLimit(bytes, maxBytes) {
  const chunks = [];
  let total = 0;
  const inflater = new pako.Inflate();
  inflater.onData = (chunk) => {
    total += chunk.length;
    if (total > maxBytes) {
      throw new Error("NBTの展開後サイズが大きすぎます。");
    }
    chunks.push(chunk);
  };
  inflater.push(bytes, true);
  if (inflater.err) {
    throw new Error(`NBTの圧縮データを展開できません: ${inflater.msg}`);
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

function decodeModifiedUtf8(bytes) {
  let result = "";
  for (let index = 0; index < bytes.length; ) {
    const first = bytes[index++];
    if ((first & 0x80) === 0) {
      if (first === 0) throw new Error("NBT文字列に不正なNULLバイトがあります。");
      result += String.fromCharCode(first);
      continue;
    }
    if ((first & 0xe0) === 0xc0) {
      if (index >= bytes.length) throw new Error("NBT文字列が途中で終了しています。");
      const second = bytes[index++];
      if ((second & 0xc0) !== 0x80) {
        throw new Error("NBT文字列のUTF-8が不正です。");
      }
      result += String.fromCharCode(((first & 0x1f) << 6) | (second & 0x3f));
      continue;
    }
    if ((first & 0xf0) === 0xe0) {
      if (index + 1 >= bytes.length) {
        throw new Error("NBT文字列が途中で終了しています。");
      }
      const second = bytes[index++];
      const third = bytes[index++];
      if ((second & 0xc0) !== 0x80 || (third & 0xc0) !== 0x80) {
        throw new Error("NBT文字列のUTF-8が不正です。");
      }
      result += String.fromCharCode(
        ((first & 0x0f) << 12) | ((second & 0x3f) << 6) | (third & 0x3f),
      );
      continue;
    }
    throw new Error("NBT文字列に未対応のUTF-8形式があります。");
  }
  return result;
}

function encodeModifiedUtf8(value) {
  const output = [];
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0x0001 && code <= 0x007f) {
      output.push(code);
    } else if (code <= 0x07ff) {
      output.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else {
      output.push(
        0xe0 | (code >> 12),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }
  if (output.length > 0xffff) {
    throw new Error("NBT文字列が65535バイトを超えています。");
  }
  return new Uint8Array(output);
}

class NbtReader {
  constructor(bytes) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.offset = 0;
    this.items = 0;
  }

  ensure(length) {
    if (length < 0 || this.offset + length > this.bytes.length) {
      throw new Error("NBTデータが途中で終了しています。");
    }
  }

  readByte() {
    this.ensure(1);
    return this.view.getInt8(this.offset++);
  }

  readUnsignedByte() {
    this.ensure(1);
    return this.view.getUint8(this.offset++);
  }

  readShort() {
    this.ensure(2);
    const value = this.view.getInt16(this.offset, false);
    this.offset += 2;
    return value;
  }

  readUnsignedShort() {
    this.ensure(2);
    const value = this.view.getUint16(this.offset, false);
    this.offset += 2;
    return value;
  }

  readInt() {
    this.ensure(4);
    const value = this.view.getInt32(this.offset, false);
    this.offset += 4;
    return value;
  }

  readLong() {
    this.ensure(8);
    const value = this.view.getBigInt64(this.offset, false);
    this.offset += 8;
    return value;
  }

  readFloat() {
    this.ensure(4);
    const value = this.view.getFloat32(this.offset, false);
    this.offset += 4;
    return value;
  }

  readDouble() {
    this.ensure(8);
    const value = this.view.getFloat64(this.offset, false);
    this.offset += 8;
    return value;
  }

  readString() {
    const length = this.readUnsignedShort();
    this.ensure(length);
    const value = decodeModifiedUtf8(
      this.bytes.subarray(this.offset, this.offset + length),
    );
    this.offset += length;
    return value;
  }

  readLength(unitBytes = 0) {
    const length = this.readInt();
    if (
      length < 0 ||
      length > MAX_NBT_ITEMS ||
      (unitBytes && length > Math.floor((this.bytes.length - this.offset) / unitBytes))
    ) {
      throw new Error("NBT配列またはリストの長さが不正です。");
    }
    return length;
  }

  countItem() {
    this.items += 1;
    if (this.items > MAX_NBT_ITEMS) {
      throw new Error("NBT内のタグ数が多すぎます。");
    }
  }

  readPayload(type, depth) {
    if (depth > MAX_NBT_DEPTH) {
      throw new Error("NBTの階層が深すぎます。");
    }
    switch (type) {
      case NBT_TAG.BYTE:
        return this.readByte();
      case NBT_TAG.SHORT:
        return this.readShort();
      case NBT_TAG.INT:
        return this.readInt();
      case NBT_TAG.LONG:
        return this.readLong();
      case NBT_TAG.FLOAT:
        return this.readFloat();
      case NBT_TAG.DOUBLE:
        return this.readDouble();
      case NBT_TAG.BYTE_ARRAY: {
        const length = this.readLength(1);
        this.ensure(length);
        const value = this.bytes.slice(this.offset, this.offset + length);
        this.offset += length;
        return value;
      }
      case NBT_TAG.STRING:
        return this.readString();
      case NBT_TAG.LIST: {
        const elementType = this.readUnsignedByte();
        if (elementType > NBT_TAG.LONG_ARRAY) {
          throw new Error(`NBTリストのタグ種別が不正です: ${elementType}`);
        }
        const length = this.readLength();
        if (elementType === NBT_TAG.END && length !== 0) {
          throw new Error("TAG_Endを要素に持つ空でないNBTリストがあります。");
        }
        const items = [];
        for (let index = 0; index < length; index += 1) {
          this.countItem();
          items.push(this.readPayload(elementType, depth + 1));
        }
        return { elementType, items };
      }
      case NBT_TAG.COMPOUND: {
        const tags = [];
        while (true) {
          const childType = this.readUnsignedByte();
          if (childType === NBT_TAG.END) break;
          if (childType > NBT_TAG.LONG_ARRAY) {
            throw new Error(`NBTタグ種別が不正です: ${childType}`);
          }
          this.countItem();
          const name = this.readString();
          tags.push({
            type: childType,
            name,
            value: this.readPayload(childType, depth + 1),
          });
        }
        return tags;
      }
      case NBT_TAG.INT_ARRAY: {
        const length = this.readLength(4);
        const value = new Int32Array(length);
        for (let index = 0; index < length; index += 1) {
          value[index] = this.readInt();
        }
        return value;
      }
      case NBT_TAG.LONG_ARRAY: {
        const length = this.readLength(8);
        const value = new BigInt64Array(length);
        for (let index = 0; index < length; index += 1) {
          value[index] = this.readLong();
        }
        return value;
      }
      default:
        throw new Error(`未対応のNBTタグ種別です: ${type}`);
    }
  }

  readRoot() {
    const type = this.readUnsignedByte();
    if (type !== NBT_TAG.COMPOUND) {
      throw new Error("NBTのルートがTAG_Compoundではありません。");
    }
    const name = this.readString();
    const root = {
      type,
      name,
      value: this.readPayload(type, 0),
    };
    if (this.offset !== this.bytes.length) {
      throw new Error("NBTの末尾に余分なデータがあります。");
    }
    return root;
  }
}

class NbtWriter {
  constructor() {
    this.bytes = new Uint8Array(1024);
    this.view = new DataView(this.bytes.buffer);
    this.offset = 0;
  }

  ensure(length) {
    const needed = this.offset + length;
    if (needed <= this.bytes.length) return;
    let size = this.bytes.length;
    while (size < needed) size *= 2;
    const replacement = new Uint8Array(size);
    replacement.set(this.bytes);
    this.bytes = replacement;
    this.view = new DataView(replacement.buffer);
  }

  writeByte(value) {
    this.ensure(1);
    this.view.setInt8(this.offset++, value);
  }

  writeUnsignedByte(value) {
    this.ensure(1);
    this.view.setUint8(this.offset++, value);
  }

  writeShort(value) {
    this.ensure(2);
    this.view.setInt16(this.offset, value, false);
    this.offset += 2;
  }

  writeUnsignedShort(value) {
    this.ensure(2);
    this.view.setUint16(this.offset, value, false);
    this.offset += 2;
  }

  writeInt(value) {
    this.ensure(4);
    this.view.setInt32(this.offset, value, false);
    this.offset += 4;
  }

  writeLong(value) {
    this.ensure(8);
    this.view.setBigInt64(this.offset, BigInt(value), false);
    this.offset += 8;
  }

  writeFloat(value) {
    this.ensure(4);
    this.view.setFloat32(this.offset, value, false);
    this.offset += 4;
  }

  writeDouble(value) {
    this.ensure(8);
    this.view.setFloat64(this.offset, value, false);
    this.offset += 8;
  }

  writeString(value) {
    const encoded = encodeModifiedUtf8(String(value));
    this.writeUnsignedShort(encoded.length);
    this.ensure(encoded.length);
    this.bytes.set(encoded, this.offset);
    this.offset += encoded.length;
  }

  writePayload(type, value, depth) {
    if (depth > MAX_NBT_DEPTH) {
      throw new Error("NBTの階層が深すぎます。");
    }
    switch (type) {
      case NBT_TAG.BYTE:
        this.writeByte(value);
        return;
      case NBT_TAG.SHORT:
        this.writeShort(value);
        return;
      case NBT_TAG.INT:
        this.writeInt(value);
        return;
      case NBT_TAG.LONG:
        this.writeLong(value);
        return;
      case NBT_TAG.FLOAT:
        this.writeFloat(value);
        return;
      case NBT_TAG.DOUBLE:
        this.writeDouble(value);
        return;
      case NBT_TAG.BYTE_ARRAY: {
        const bytes = asUint8Array(value);
        this.writeInt(bytes.length);
        this.ensure(bytes.length);
        this.bytes.set(bytes, this.offset);
        this.offset += bytes.length;
        return;
      }
      case NBT_TAG.STRING:
        this.writeString(value);
        return;
      case NBT_TAG.LIST: {
        const elementType = Number(value.elementType);
        const items = value.items || [];
        if (
          elementType < NBT_TAG.END ||
          elementType > NBT_TAG.LONG_ARRAY ||
          (elementType === NBT_TAG.END && items.length)
        ) {
          throw new Error("NBTリストのタグ種別が不正です。");
        }
        this.writeUnsignedByte(elementType);
        this.writeInt(items.length);
        for (const item of items) {
          this.writePayload(elementType, item, depth + 1);
        }
        return;
      }
      case NBT_TAG.COMPOUND:
        for (const child of value || []) {
          if (
            !child ||
            child.type <= NBT_TAG.END ||
            child.type > NBT_TAG.LONG_ARRAY
          ) {
            throw new Error("NBT Compound内のタグ種別が不正です。");
          }
          this.writeUnsignedByte(child.type);
          this.writeString(child.name);
          this.writePayload(child.type, child.value, depth + 1);
        }
        this.writeUnsignedByte(NBT_TAG.END);
        return;
      case NBT_TAG.INT_ARRAY:
        this.writeInt(value.length);
        for (const item of value) this.writeInt(item);
        return;
      case NBT_TAG.LONG_ARRAY:
        this.writeInt(value.length);
        for (const item of value) this.writeLong(item);
        return;
      default:
        throw new Error(`未対応のNBTタグ種別です: ${type}`);
    }
  }

  writeRoot(root) {
    if (root?.type !== NBT_TAG.COMPOUND) {
      throw new Error("NBTのルートがTAG_Compoundではありません。");
    }
    this.writeUnsignedByte(root.type);
    this.writeString(root.name || "");
    this.writePayload(root.type, root.value, 0);
    return this.bytes.slice(0, this.offset);
  }
}

export function decodeNbt(bytes) {
  const input = asUint8Array(bytes);
  return new NbtReader(input).readRoot();
}

export function encodeNbt(root) {
  return new NbtWriter().writeRoot(root);
}

function cloneNbtValue(type, value) {
  if (type === NBT_TAG.BYTE_ARRAY) return value.slice();
  if (type === NBT_TAG.INT_ARRAY) return new Int32Array(value);
  if (type === NBT_TAG.LONG_ARRAY) return new BigInt64Array(value);
  if (type === NBT_TAG.LIST) {
    return {
      elementType: value.elementType,
      items: value.items.map((item) => cloneNbtValue(value.elementType, item)),
    };
  }
  if (type === NBT_TAG.COMPOUND) {
    return value.map((child) => ({
      type: child.type,
      name: child.name,
      value: cloneNbtValue(child.type, child.value),
    }));
  }
  return value;
}

export function cloneNbtDocument(document) {
  return {
    compression: document.compression,
    root: {
      type: document.root.type,
      name: document.root.name,
      value: cloneNbtValue(document.root.type, document.root.value),
    },
  };
}

export function parseNbt(bytes, { maxBytes = 10 * 1024 * 1024 } = {}) {
  const input = asUint8Array(bytes);
  let compression = "raw";
  let decoded = input;
  if (input[0] === 0x1f && input[1] === 0x8b) {
    compression = "gzip";
    decoded = decompressWithLimit(input, maxBytes);
  } else if (isZlib(input)) {
    compression = "zlib";
    decoded = decompressWithLimit(input, maxBytes);
  } else if (input.length > maxBytes) {
    throw new Error("NBTのサイズが大きすぎます。");
  }
  return {
    root: decodeNbt(decoded),
    compression,
  };
}

export function writeNbt(document) {
  const bytes = encodeNbt(document.root);
  if (document.compression === "gzip") return pako.gzip(bytes);
  if (document.compression === "zlib") return pako.deflate(bytes);
  return bytes;
}
