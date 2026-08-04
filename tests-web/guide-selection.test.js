import test from "node:test";
import assert from "node:assert/strict";
import {
  minecraftGuideModeForProject,
  selectGuideForProject,
} from "../src/guide-selection.js";

test("Minecraftの解析形式に対応する使い方を選ぶ", () => {
  assert.equal(
    minecraftGuideModeForProject({ game: "minecraft", artifactType: "server_plugin" }),
    "serverPlugin",
  );
  assert.equal(
    minecraftGuideModeForProject({ game: "minecraft", artifactType: "bedrock_addon" }),
    "bedrockAddon",
  );
  assert.equal(
    minecraftGuideModeForProject({ game: "minecraft", artifactType: "resource_pack" }),
    "javaResourcePack",
  );
});

test("複数形式では件数が最も多い形式を選ぶ", () => {
  const selection = selectGuideForProject({
    artifactType: "batch",
    sourceProjects: [
      { game: "minecraft", artifactType: "data_pack" },
      { game: "minecraft", artifactType: "resource_pack" },
      { game: "minecraft", artifactType: "resource_pack" },
    ],
  });
  assert.deepEqual(selection, {
    game: "minecraft",
    minecraftMode: "javaResourcePack",
  });
});

test("複数形式が同数なら最初の形式を選ぶ", () => {
  const selection = selectGuideForProject({
    artifactType: "batch",
    sourceProjects: [
      { game: "minecraft", artifactType: "data_pack" },
      { game: "minecraft", artifactType: "resource_pack" },
      { game: "minecraft", artifactType: "resource_pack" },
      { game: "minecraft", artifactType: "data_pack" },
    ],
  });
  assert.deepEqual(selection, {
    game: "minecraft",
    minecraftMode: "dataPack",
  });
});

test("複数ゲームでも件数と入力順で使い方を選ぶ", () => {
  assert.deepEqual(
    selectGuideForProject({
      sourceProjects: [
        { game: "factorio" },
        { game: "stardew" },
        { game: "stardew" },
      ],
    }),
    { game: "stardew", minecraftMode: "javaMod" },
  );
  assert.deepEqual(selectGuideForProject({ game: "rimworld" }), {
    game: "rimworld",
    minecraftMode: "javaMod",
  });
});
