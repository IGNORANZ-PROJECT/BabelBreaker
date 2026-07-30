import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDirectory = path.join(projectRoot, "public");
const lock = JSON.parse(await fs.readFile(path.join(projectRoot, "package-lock.json"), "utf8"));
const licenseCandidates = [
  "LICENSE",
  "LICENSE.md",
  "LICENSE.markdown",
  "LICENSE.txt",
  "license",
  "license.md",
  "license.txt",
  "COPYING",
];

function packageNameFromInstallPath(installPath) {
  const relative = installPath.replace(/^node_modules\//, "");
  const parts = relative.split("/node_modules/");
  return parts.at(-1);
}

async function readLicense(packageDirectory) {
  for (const candidate of licenseCandidates) {
    try {
      return await fs.readFile(path.join(packageDirectory, candidate), "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  try {
    const readme = await fs.readFile(path.join(packageDirectory, "README.md"), "utf8");
    const embeddedLicense = readme.match(/^## License\s*([\s\S]+)$/im)?.[1]?.trim();
    if (embeddedLicense) return embeddedLicense;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return "";
}

async function readSpdxLicense(licenseId) {
  if (!licenseId || !/^[A-Za-z0-9.+-]+$/.test(licenseId)) return "";
  try {
    const spdxPath = path.join(
      projectRoot,
      "node_modules",
      "spdx-license-list",
      "licenses",
      `${licenseId}.json`,
    );
    const record = JSON.parse(await fs.readFile(spdxPath, "utf8"));
    return String(record.licenseText || "");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return "";
  }
}

const productionPackages = Object.entries(lock.packages || {})
  .filter(([installPath, metadata]) => installPath.startsWith("node_modules/") && !metadata.dev)
  .sort(([left], [right]) => left.localeCompare(right));

const sections = [
  "Babel Breaker — Third-Party Notices",
  "",
  "The production web bundle includes the following packages.",
  "Each package remains available under its respective license.",
  "",
  "Runtime models:",
  "Mozilla Firefox Translations bidirectional English models for Japanese, Korean,",
  "Simplified Chinese, Traditional Chinese, German, Spanish, French, Portuguese,",
  "Russian, and Italian. Non-English language pairs pivot through English locally.",
  "Source: https://github.com/mozilla/firefox-translations-models",
  "License: MPL-2.0 (the complete license text is included below)",
  "",
];

for (const [installPath, metadata] of productionPackages) {
  const packageName = packageNameFromInstallPath(installPath);
  const packageDirectory = path.join(projectRoot, installPath);
  const licenseText = (
    (await readLicense(packageDirectory)) ||
    (await readSpdxLicense(metadata.license))
  )
    .replace(/[ \t]+$/gm, "")
    .trim();
  if (!licenseText) {
    throw new Error(`License text was not found for ${packageName}@${metadata.version}`);
  }
  sections.push(
    "=".repeat(72),
    `${packageName}@${metadata.version}`,
    `Declared license: ${metadata.license || "See license text below"}`,
    "=".repeat(72),
    "",
    licenseText,
    "",
  );
}

await fs.mkdir(publicDirectory, { recursive: true });
await fs.copyFile(path.join(projectRoot, "LICENSE"), path.join(publicDirectory, "LICENSE.txt"));
await fs.writeFile(
  path.join(publicDirectory, "THIRD_PARTY_NOTICES.txt"),
  `${sections.join("\n").trim()}\n`,
  "utf8",
);
