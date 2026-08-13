import assert from "node:assert/strict";
import { File } from "node:buffer";
import test from "node:test";
import JSZip from "jszip";

import { analyzeArchive, buildResourcePack } from "../src/core.js";
import { scanProjectImages } from "../src/image-assets.js";

function fakePng(width, height) {
  const bytes = new Uint8Array(32);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

async function archiveFile(name, files) {
  const zip = new JSZip();
  for (const [path, contents] of Object.entries(files)) zip.file(path, contents);
  return new File([await zip.generateAsync({ type: "uint8array" })], name);
}

test("optional image scanning finds UI textures without decoding unrelated files", async () => {
  const file = await archiveFile("UI.zip", {
    "pack.mcmeta": JSON.stringify({ pack: { pack_format: 34, description: "UI" } }),
    "assets/example/lang/en_us.json": JSON.stringify({ title: "Title" }),
    "assets/example/textures/gui/title.png": fakePng(256, 64),
    "assets/example/textures/gui/empty.png": new Uint8Array([1, 2, 3]),
  });
  const project = await analyzeArchive(file);
  const images = await scanProjectImages(project);
  assert.equal(images.length, 1);
  assert.equal(images[0].path, "assets/example/textures/gui/title.png");
  assert.deepEqual([images[0].width, images[0].height], [256, 64]);
});

test("edited Bedrock images return to the same nested path and container", async () => {
  const resource = new JSZip();
  resource.file("manifest.json", JSON.stringify({
    format_version: 2,
    header: { name: "UI", description: "UI", uuid: "11111111-1111-1111-1111-111111111111", version: [1, 0, 0] },
    modules: [{ type: "resources", uuid: "22222222-2222-2222-2222-222222222222", version: [1, 0, 0] }],
  }));
  resource.file("texts/en_US.lang", "title=Title\n");
  resource.file("textures/ui/title.png", fakePng(128, 32));
  const file = await archiveFile("UI.mcaddon", {
    "packs/UI.mcpack": await resource.generateAsync({ type: "uint8array" }),
  });
  const project = await analyzeArchive(file);
  const images = await scanProjectImages(project);
  assert.equal(images.length, 1);
  const replacementBytes = fakePng(64, 16);
  project.imageReplacements = [{
    containerId: images[0].containerId,
    path: images[0].path,
    bytes: replacementBytes,
  }];
  const result = await buildResourcePack(project, project.minecraftVersion, "uint8array");
  const output = await JSZip.loadAsync(result.archive);
  const nested = await JSZip.loadAsync(await output.file("UI.mcpack").async("uint8array"));
  assert.deepEqual(await nested.file("textures/ui/title.png").async("uint8array"), replacementBytes);
});
