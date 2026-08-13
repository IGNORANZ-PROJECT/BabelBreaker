import assert from "node:assert/strict";
import test from "node:test";

import {
  bedrockLocalizationSummary,
  recommendedBedrockOutputMode,
} from "../src/bedrock-output-mode.js";

function bedrockProject(confirmed) {
  return {
    artifactType: "bedrock_addon",
    documents: [{
      format: "bedrock-lang",
      localizationEvidence: { confirmed },
    }],
  };
}

test("Bedrock Add-ons default to reliable source replacement", () => {
  assert.equal(recommendedBedrockOutputMode(bedrockProject(false)), "forced");
  assert.equal(recommendedBedrockOutputMode(bedrockProject(true)), "forced");
});

test("non-Bedrock outputs keep localized mode", () => {
  assert.equal(recommendedBedrockOutputMode({ artifactType: "java_mod", documents: [] }), "localized");
});

test("Bedrock localization evidence remains available for the status message", () => {
  assert.deepEqual(bedrockLocalizationSummary(bedrockProject(true)), {
    total: 1,
    uncertain: 0,
    confirmed: 1,
  });
});
