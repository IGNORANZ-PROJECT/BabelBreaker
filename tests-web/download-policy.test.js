import assert from "node:assert/strict";
import test from "node:test";

import { requiresPreparedBatchDownload } from "../src/download-policy.js";

test("combined archives use a user-activated save step", () => {
  assert.equal(requiresPreparedBatchDownload({ artifactBatch: true }), true);
  assert.equal(requiresPreparedBatchDownload({ isBatch: true }), true);
});

test("single archives keep immediate download", () => {
  assert.equal(requiresPreparedBatchDownload({ artifactType: "bedrock_addon" }), false);
  assert.equal(requiresPreparedBatchDownload(null), false);
});
