import { createWorker, OEM, PSM } from "tesseract.js";

const OCR_LANGUAGE = {
  en: "eng", ja: "jpn", ko: "kor", "zh-Hans": "chi_sim", "zh-Hant": "chi_tra",
  de: "deu", es: "spa", fr: "fra", pt: "por", ru: "rus", it: "ita",
};

export function ocrLanguagesForProject(project) {
  const source = [...new Set(project.sourceLanguages || [])]
    .map((id) => OCR_LANGUAGE[id])
    .filter(Boolean)
    .slice(0, 2);
  return source.length ? source : ["eng"];
}

function decodeTga(bytes) {
  if (bytes.length < 18) throw new Error("TGA header is incomplete.");
  const idLength = bytes[0];
  const colorMapType = bytes[1];
  const imageType = bytes[2];
  const width = bytes[12] | (bytes[13] << 8);
  const height = bytes[14] | (bytes[15] << 8);
  const depth = bytes[16];
  const topOrigin = Boolean(bytes[17] & 0x20);
  if (colorMapType || ![2, 10].includes(imageType) || ![24, 32].includes(depth)) {
    throw new Error("This TGA encoding is not supported. Use an uncompressed or RLE 24/32-bit TGA.");
  }
  const pixelSize = depth / 8;
  const rgba = new Uint8ClampedArray(width * height * 4);
  let input = 18 + idLength;
  let pixel = 0;
  const writePixel = (targetPixel, sourceOffset) => {
    const sourceY = Math.floor(targetPixel / width);
    const x = targetPixel % width;
    const y = topOrigin ? sourceY : height - 1 - sourceY;
    const output = (y * width + x) * 4;
    rgba[output] = bytes[sourceOffset + 2];
    rgba[output + 1] = bytes[sourceOffset + 1];
    rgba[output + 2] = bytes[sourceOffset];
    rgba[output + 3] = pixelSize === 4 ? bytes[sourceOffset + 3] : 255;
  };
  while (pixel < width * height && input < bytes.length) {
    if (imageType === 2) {
      writePixel(pixel++, input);
      input += pixelSize;
      continue;
    }
    const packet = bytes[input++];
    const count = (packet & 0x7f) + 1;
    if (packet & 0x80) {
      for (let index = 0; index < count && pixel < width * height; index += 1) writePixel(pixel++, input);
      input += pixelSize;
    } else {
      for (let index = 0; index < count && pixel < width * height; index += 1) {
        writePixel(pixel++, input);
        input += pixelSize;
      }
    }
  }
  if (pixel !== width * height) throw new Error("TGA pixel data is incomplete.");
  return new ImageData(rgba, width, height);
}

async function canvasFromCandidate(candidate) {
  const canvas = document.createElement("canvas");
  canvas.width = candidate.width;
  canvas.height = candidate.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (candidate.mime === "image/x-tga") {
    context.putImageData(decodeTga(candidate.bytes), 0, 0);
    return canvas;
  }
  const blob = new Blob([candidate.bytes], { type: candidate.mime });
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(blob);
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    return canvas;
  }
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    context.drawImage(image, 0, 0);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function candidatePreviewUrl(candidate) {
  if (candidate.previewUrl) return candidate.previewUrl;
  const canvas = await canvasFromCandidate(candidate);
  return canvas.toDataURL("image/png");
}

export async function createImageRecognizer({
  languages = ["eng"],
  onProgress = () => {},
} = {}) {
  const worker = await createWorker(languages, OEM.LSTM_ONLY, {
    workerPath: "https://cdn.jsdelivr.net/npm/tesseract.js@v7.0.0/dist/worker.min.js",
    corePath: "https://cdn.jsdelivr.net/npm/tesseract.js-core@v7.0.0",
    logger(message) {
      onProgress({ status: message.status, percent: Math.round((message.progress || 0) * 100) });
    },
  });
  await worker.setParameters({
    tessedit_pageseg_mode: PSM.SPARSE_TEXT_OSD,
    user_defined_dpi: "300",
  });
  return {
    async recognize(candidate) {
      const canvas = await canvasFromCandidate(candidate);
    const result = await worker.recognize(canvas, { rotateAuto: true }, { text: true, blocks: true });
    const lines = (result.data.blocks || [])
      .flatMap((block) => block.paragraphs || [])
      .flatMap((paragraph) => paragraph.lines || []);
      return lines
      .map((line, index) => {
        const text = String(line.text || "").replace(/\s+/g, " ").trim();
        const bbox = line.bbox || {};
        const angle = line.baseline
          ? Math.atan2(line.baseline.y1 - line.baseline.y0, line.baseline.x1 - line.baseline.x0) * 180 / Math.PI
          : 0;
        return {
          id: `${candidate.id}:region:${index}`,
          text,
          translation: "",
          confidence: Math.round(line.confidence || 0),
          x: Math.max(0, Math.round(bbox.x0 || 0)),
          y: Math.max(0, Math.round(bbox.y0 || 0)),
          width: Math.max(1, Math.round((bbox.x1 || 0) - (bbox.x0 || 0))),
          height: Math.max(1, Math.round((bbox.y1 || 0) - (bbox.y0 || 0))),
          angle: Math.max(-45, Math.min(45, Math.round(angle * 10) / 10)),
          enabled: true,
        };
      })
        .filter((region) => region.text && /\p{L}/u.test(region.text) && region.confidence >= 25);
    },
    terminate() {
      return worker.terminate();
    },
  };
}

export async function recognizeImageText(candidate, options = {}) {
  const recognizer = await createImageRecognizer(options);
  try {
    return await recognizer.recognize(candidate);
  } finally {
    await recognizer.terminate();
  }
}

function sampledBackground(context, region, canvas) {
  const padding = Math.max(2, Math.round(Math.min(region.width, region.height) * 0.08));
  const x = Math.max(0, region.x - padding);
  const y = Math.max(0, region.y - padding);
  const width = Math.min(canvas.width - x, region.width + padding * 2);
  const height = Math.min(canvas.height - y, region.height + padding * 2);
  const data = context.getImageData(x, y, width, height).data;
  let red = 0; let green = 0; let blue = 0; let alpha = 0; let count = 0;
  for (let offset = 0; offset < data.length; offset += 4) {
    const pixelIndex = offset / 4;
    const px = pixelIndex % width;
    const py = Math.floor(pixelIndex / width);
    if (px > padding && px < width - padding && py > padding && py < height - padding) continue;
    red += data[offset]; green += data[offset + 1]; blue += data[offset + 2]; alpha += data[offset + 3]; count += 1;
  }
  return {
    color: `rgba(${Math.round(red / count)},${Math.round(green / count)},${Math.round(blue / count)},${Math.max(0.88, alpha / count / 255)})`,
    luminance: (red * 0.2126 + green * 0.7152 + blue * 0.0722) / count,
  };
}

function wrapText(context, text, maxWidth) {
  const segments = /\s/.test(text) ? text.split(/\s+/) : [...text];
  const separator = /\s/.test(text) ? " " : "";
  const lines = [];
  let current = "";
  for (const segment of segments) {
    const trial = current ? `${current}${separator}${segment}` : segment;
    if (current && context.measureText(trial).width > maxWidth) {
      lines.push(current);
      current = segment;
    } else current = trial;
  }
  if (current) lines.push(current);
  return lines;
}

function fitText(context, text, width, height) {
  let low = 5;
  let high = Math.max(6, Math.min(160, height * 1.4));
  let best = { size: 5, lines: [text] };
  while (high - low > 0.5) {
    const size = (low + high) / 2;
    context.font = `600 ${size}px system-ui, sans-serif`;
    const lines = wrapText(context, text, width);
    const fits = lines.length * size * 1.16 <= height && lines.every((line) => context.measureText(line).width <= width);
    if (fits) { best = { size, lines }; low = size; } else high = size;
  }
  return best;
}

function encodeTga(context, width, height) {
  const rgba = context.getImageData(0, 0, width, height).data;
  const output = new Uint8Array(18 + width * height * 4);
  output[2] = 2;
  output[12] = width & 0xff; output[13] = width >> 8;
  output[14] = height & 0xff; output[15] = height >> 8;
  output[16] = 32; output[17] = 0x28;
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const input = pixel * 4;
    const target = 18 + input;
    output[target] = rgba[input + 2];
    output[target + 1] = rgba[input + 1];
    output[target + 2] = rgba[input];
    output[target + 3] = rgba[input + 3];
  }
  return output;
}

export async function renderTranslatedImage(candidate, regions) {
  const canvas = await canvasFromCandidate(candidate);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  for (const region of regions.filter((item) => item.enabled && String(item.translation || "").trim())) {
    const x = Math.max(0, Math.min(canvas.width - 1, Number(region.x)));
    const y = Math.max(0, Math.min(canvas.height - 1, Number(region.y)));
    const width = Math.max(1, Math.min(canvas.width - x, Number(region.width)));
    const height = Math.max(1, Math.min(canvas.height - y, Number(region.height)));
    const safeRegion = { ...region, x, y, width, height };
    const background = sampledBackground(context, safeRegion, canvas);
    context.save();
    context.beginPath();
    context.rect(x, y, width, height);
    context.clip();
    context.fillStyle = background.color;
    context.fillRect(x, y, width, height);
    context.translate(x + width / 2, y + height / 2);
    context.rotate((Number(region.angle) || 0) * Math.PI / 180);
    const innerWidth = width * 0.92;
    const innerHeight = height * 0.9;
    const fitted = fitText(context, String(region.translation), innerWidth, innerHeight);
    context.font = `600 ${fitted.size}px system-ui, sans-serif`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillStyle = background.luminance > 135 ? "#101218" : "#ffffff";
    context.strokeStyle = background.luminance > 135 ? "rgba(255,255,255,.28)" : "rgba(0,0,0,.5)";
    context.lineWidth = Math.max(1, fitted.size * 0.07);
    const lineHeight = fitted.size * 1.16;
    const startY = -(fitted.lines.length - 1) * lineHeight / 2;
    fitted.lines.forEach((line, index) => {
      const lineY = startY + index * lineHeight;
      context.strokeText(line, 0, lineY, innerWidth);
      context.fillText(line, 0, lineY, innerWidth);
    });
    context.restore();
  }
  if (candidate.mime === "image/x-tga") return encodeTga(context, canvas.width, canvas.height);
  const type = candidate.mime === "image/jpeg" ? "image/jpeg" : "image/png";
  const blob = await new Promise((resolve, reject) => canvas.toBlob(
    (result) => result ? resolve(result) : reject(new Error("The edited image could not be encoded.")),
    type,
    0.94,
  ));
  return new Uint8Array(await blob.arrayBuffer());
}
