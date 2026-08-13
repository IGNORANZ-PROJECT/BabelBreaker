import JSZip from "jszip";

const IMAGE_PATH = /\.(?:png|jpe?g|tga)$/i;
const LIKELY_UI_PATH = /(?:^|\/)(?:textures?|gui|ui|interface|sprites?|images?|assets)(?:\/|$)/i;
const MAX_IMAGES = 80;
const MAX_IMAGE_BYTES = 16 * 1024 * 1024;
const MAX_TOTAL_BYTES = 96 * 1024 * 1024;

function imageMime(path) {
  if (/\.png$/i.test(path)) return "image/png";
  if (/\.jpe?g$/i.test(path)) return "image/jpeg";
  return "image/x-tga";
}

function pngSize(bytes) {
  if (bytes.length < 24 || bytes[0] !== 0x89 || bytes[1] !== 0x50) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

function jpegSize(bytes) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) { offset += 1; continue; }
    const marker = bytes[offset + 1];
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return {
        height: (bytes[offset + 5] << 8) | bytes[offset + 6],
        width: (bytes[offset + 7] << 8) | bytes[offset + 8],
      };
    }
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (length < 2) break;
    offset += length + 2;
  }
  return null;
}

function tgaSize(bytes) {
  if (bytes.length < 18) return null;
  const width = bytes[12] | (bytes[13] << 8);
  const height = bytes[14] | (bytes[15] << 8);
  return width && height ? { width, height } : null;
}

function imageSize(bytes, path) {
  if (/\.png$/i.test(path)) return pngSize(bytes);
  if (/\.jpe?g$/i.test(path)) return jpegSize(bytes);
  return tgaSize(bytes);
}

async function scanZip(bytes, containerId, candidates, budget) {
  const zip = await JSZip.loadAsync(bytes, { createFolders: false });
  const entries = Object.values(zip.files)
    .filter((entry) => !entry.dir && IMAGE_PATH.test(entry.name))
    .sort((left, right) => Number(LIKELY_UI_PATH.test(right.name)) - Number(LIKELY_UI_PATH.test(left.name)));
  for (const entry of entries) {
    if (candidates.length >= MAX_IMAGES || budget.total >= MAX_TOTAL_BYTES) break;
    const declaredSize = Number(entry?._data?.uncompressedSize || 0);
    if (declaredSize > MAX_IMAGE_BYTES) continue;
    const imageBytes = await entry.async("uint8array");
    if (!imageBytes.length || imageBytes.length > MAX_IMAGE_BYTES) continue;
    const size = imageSize(imageBytes, entry.name);
    if (!size || size.width < 24 || size.height < 12 || size.width * size.height > 40_000_000) continue;
    budget.total += imageBytes.byteLength;
    candidates.push({
      id: `${containerId}:${entry.name}`,
      containerId,
      path: entry.name,
      name: entry.name.split("/").at(-1),
      mime: imageMime(entry.name),
      width: size.width,
      height: size.height,
      bytes: imageBytes,
      likelyUi: LIKELY_UI_PATH.test(entry.name),
    });
  }
}

export async function scanProjectImages(project) {
  if (Array.isArray(project.sourceProjects)) {
    const combined = [];
    for (const [sourceProjectIndex, sourceProject] of project.sourceProjects.entries()) {
      const images = await scanProjectImages(sourceProject);
      combined.push(...images.map((image) => ({
        ...image,
        id: `project:${sourceProjectIndex}:${image.id}`,
        sourceProjectIndex,
        sourceFileName: sourceProject.fileName,
      })));
      if (combined.length >= MAX_IMAGES) break;
    }
    return combined.slice(0, MAX_IMAGES);
  }
  const candidates = [];
  const budget = { total: 0 };
  const rootBytes = project.artifactState?.sourceBytes || project.sourceBytes;
  if (rootBytes) await scanZip(rootBytes, "root", candidates, budget);
  for (const container of project.artifactState?.containers || []) {
    if (container.id === "root" || !container.sourceBytes) continue;
    await scanZip(container.sourceBytes, container.id, candidates, budget);
  }
  return candidates;
}
