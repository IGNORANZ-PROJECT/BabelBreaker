import assert from "node:assert/strict";
import test from "node:test";

import {
  NBT_TAG,
  cloneNbtDocument,
  decodeNbt,
  decodeNbtSequence,
  encodeNbt,
  encodeNbtSequence,
  parseNbt,
  writeNbt,
} from "../src/nbt.js";

function allTagTypesRoot() {
  return {
    type: NBT_TAG.COMPOUND,
    name: "Root\u0000😀",
    value: [
      { type: NBT_TAG.BYTE, name: "byte", value: -12 },
      { type: NBT_TAG.SHORT, name: "short", value: -1234 },
      { type: NBT_TAG.INT, name: "int", value: 123456789 },
      { type: NBT_TAG.LONG, name: "long", value: -1234567890123456789n },
      { type: NBT_TAG.FLOAT, name: "float", value: 1.25 },
      { type: NBT_TAG.DOUBLE, name: "double", value: Math.PI },
      {
        type: NBT_TAG.BYTE_ARRAY,
        name: "bytes",
        value: new Uint8Array([0, 127, 128, 255]),
      },
      { type: NBT_TAG.STRING, name: "title", value: "Quest\u0000日本語😀" },
      {
        type: NBT_TAG.LIST,
        name: "list",
        value: { elementType: NBT_TAG.INT, items: [1, -2, 3] },
      },
      {
        type: NBT_TAG.COMPOUND,
        name: "child",
        value: [{ type: NBT_TAG.STRING, name: "name", value: "Nested" }],
      },
      {
        type: NBT_TAG.INT_ARRAY,
        name: "ints",
        value: new Int32Array([-2147483648, 0, 2147483647]),
      },
      {
        type: NBT_TAG.LONG_ARRAY,
        name: "longs",
        value: new BigInt64Array([-9223372036854775808n, 9223372036854775807n]),
      },
    ],
  };
}

test("NBT codec round-trips every Java Edition tag type without type loss", () => {
  const encoded = encodeNbt(allTagTypesRoot());
  const decoded = decodeNbt(encoded);
  assert.deepEqual(encodeNbt(decoded), encoded);
  assert.equal(decoded.name, "Root\u0000😀");
  assert.equal(
    decoded.value.find((tag) => tag.name === "title").value,
    "Quest\u0000日本語😀",
  );
});

test("NBT codec preserves gzip and zlib compression", () => {
  for (const compression of ["gzip", "zlib"]) {
    const document = { root: allTagTypesRoot(), compression };
    const compressed = writeNbt(document);
    const parsed = parseNbt(compressed);
    assert.equal(parsed.compression, compression);
    assert.deepEqual(encodeNbt(parsed.root), encodeNbt(document.root));
  }
});

test("NBT codec round-trips Bedrock little-endian UTF-8 sequences", () => {
  const first = allTagTypesRoot();
  first.name = "Bedrock😀";
  const second = {
    type: NBT_TAG.COMPOUND,
    name: "",
    value: [{ type: NBT_TAG.STRING, name: "Text", value: "Welcome 世界🌍" }],
  };
  const options = { littleEndian: true, stringEncoding: "utf8" };
  const encoded = encodeNbtSequence([first, second], options);
  const decoded = decodeNbtSequence(encoded, options);
  assert.equal(decoded.length, 2);
  assert.equal(decoded[0].name, "Bedrock😀");
  assert.equal(decoded[1].value[0].value, "Welcome 世界🌍");
  assert.deepEqual(encodeNbtSequence(decoded, options), encoded);
});

test("cloned NBT documents can be edited without mutating source data", () => {
  const source = { root: allTagTypesRoot(), compression: "raw" };
  const cloned = cloneNbtDocument(source);
  cloned.root.value.find((tag) => tag.name === "title").value = "Changed";
  cloned.root.value.find((tag) => tag.name === "bytes").value[0] = 99;
  assert.equal(
    source.root.value.find((tag) => tag.name === "title").value,
    "Quest\u0000日本語😀",
  );
  assert.equal(source.root.value.find((tag) => tag.name === "bytes").value[0], 0);
});

test("NBT parser rejects truncated and over-limit compressed data", () => {
  const raw = encodeNbt(allTagTypesRoot());
  assert.throws(() => decodeNbt(raw.subarray(0, raw.length - 1)), /途中/);
  const compressed = writeNbt({
    root: {
      type: NBT_TAG.COMPOUND,
      name: "",
      value: [
        {
          type: NBT_TAG.STRING,
          name: "description",
          value: "A".repeat(50_000),
        },
      ],
    },
    compression: "gzip",
  });
  assert.throws(() => parseNbt(compressed, { maxBytes: 1024 }), /大きすぎ/);
});
