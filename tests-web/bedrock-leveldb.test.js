import assert from "node:assert/strict";
import test from "node:test";

import {
  buildLevelDbWriteLog,
  decodeLevelDbWriteLog,
} from "../src/bedrock-leveldb.js";

test("Bedrock LevelDB patch fragments large batches without losing bytes", () => {
  const key = new TextEncoder().encode("actorprefix-large-record");
  const value = new Uint8Array(96 * 1024);
  value.forEach((_, index) => {
    value[index] = index % 251;
  });
  const log = buildLevelDbWriteLog([{ key, value }], 1234n);
  const decoded = decodeLevelDbWriteLog(log);
  assert.equal(decoded.length, 1);
  assert.equal(decoded[0].sequence, 1234n);
  assert.deepEqual(decoded[0].key, key);
  assert.deepEqual(decoded[0].value, value);
});

test("Bedrock LevelDB patch rejects checksum corruption", () => {
  const log = buildLevelDbWriteLog([{
    key: new TextEncoder().encode("actorprefix-safe"),
    value: new Uint8Array([10, 0, 0]),
  }], 2n);
  const corrupted = log.slice();
  corrupted[corrupted.length - 1] ^= 0xff;
  assert.throws(
    () => decodeLevelDbWriteLog(corrupted),
    /チェックサム/,
  );
});

test("Bedrock LevelDB reader accepts existing deletion records without emitting them", () => {
  const key = new TextEncoder().encode("actorprefix-removed");
  assert.throws(
    () => buildLevelDbWriteLog([{ key, deleted: true }], 9n),
    /削除操作/,
  );
  const existingLog = buildLevelDbWriteLog(
    [{ key, deleted: true }],
    9n,
    { allowDeletes: true },
  );
  const [record] = decodeLevelDbWriteLog(existingLog);
  assert.equal(record.sequence, 9n);
  assert.deepEqual(record.key, key);
  assert.equal(record.value, null);
  assert.equal(record.deleted, true);
});
