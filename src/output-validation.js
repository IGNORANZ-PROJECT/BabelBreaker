function outputFiles(zip) {
  return Object.values(zip.files).filter((entry) => !entry.dir);
}

async function readJsonEntry(entry) {
  if (!entry) return null;
  try {
    return JSON.parse(await entry.async("string"));
  } catch {
    return null;
  }
}

function requireFile(errors, files, path, label) {
  const entry = files.find((item) => item.name === path);
  if (!entry) errors.push(`${label}: required root file ${path} is missing.`);
  return entry;
}

function requireMatch(errors, files, pattern, description, label) {
  const entries = files.filter((item) => pattern.test(item.name));
  if (!entries.length) errors.push(`${label}: required ${description} is missing.`);
  return entries;
}

export async function validateNativeOutputLayout(zip, {
  kind,
  variant = "",
  label = "Output",
} = {}) {
  const errors = [];
  const files = outputFiles(zip);
  if (!files.length) errors.push(`${label}: archive is empty.`);

  if (kind === "java_resource_pack" || kind === "data_pack") {
    const metadataEntry = requireFile(errors, files, "pack.mcmeta", label);
    const metadata = await readJsonEntry(metadataEntry);
    if (metadataEntry && (!metadata?.pack || typeof metadata.pack !== "object")) {
      errors.push(`${label}: pack.mcmeta is not valid pack metadata.`);
    }
    if (kind === "java_resource_pack") {
      requireMatch(errors, files, /^assets\/[^/]+\/lang\/[^/]+\.(?:json|lang)$/i, "language file under assets/<namespace>/lang", label);
    } else {
      requireMatch(errors, files, /^data\/[^/]+\//i, "data/<namespace> content", label);
    }
  } else if (kind === "java_world") {
    requireFile(errors, files, "level.dat", label);
  } else if (kind === "bedrock_world") {
    requireFile(errors, files, "level.dat", label);
    requireMatch(errors, files, /^db\//i, "Bedrock LevelDB directory", label);
  } else if (kind === "modpack") {
    if (variant === "modrinth") {
      const indexEntry = requireFile(errors, files, "modrinth.index.json", label);
      const index = await readJsonEntry(indexEntry);
      if (indexEntry && (
        Number(index?.formatVersion) !== 1 ||
        index?.game !== "minecraft" ||
        !String(index?.name || "").trim() ||
        !String(index?.versionId || "").trim()
      )) {
        errors.push(`${label}: modrinth.index.json is not a valid Modrinth pack index.`);
      }
    } else if (variant === "curseforge") {
      const manifestEntry = requireFile(errors, files, "manifest.json", label);
      const manifest = await readJsonEntry(manifestEntry);
      if (manifestEntry && (
        manifest?.manifestType !== "minecraftModpack" ||
        Number(manifest?.manifestVersion) !== 1
      )) {
        errors.push(`${label}: manifest.json is not a valid CurseForge modpack manifest.`);
      }
    } else {
      requireMatch(errors, files, /(^|\/)mods\/[^/]+\.jar$/i, "mods directory", label);
    }
  } else if (kind === "server_plugin_patch") {
    requireFile(errors, files, "README.txt", label);
    requireMatch(errors, files, /^plugins\/[^/]+\/.+/i, "plugins/<plugin> translation file", label);
  } else if (kind === "factorio") {
    const infoEntries = requireMatch(errors, files, /^[^/]+\/info\.json$/i, "top-level mod info.json", label);
    const info = await readJsonEntry(infoEntries[0]);
    if (infoEntries.length && (
      !String(info?.name || "").trim() ||
      !String(info?.version || "").trim()
    )) {
      errors.push(`${label}: Factorio info.json requires name and version.`);
    }
    if (infoEntries.length && info) {
      const actualRoot = infoEntries[0].name.split("/")[0];
      const expectedRoot = `${info.name}_${info.version}`;
      if (actualRoot !== expectedRoot) {
        errors.push(`${label}: Factorio root folder must be ${expectedRoot}.`);
      }
    }
    requireMatch(errors, files, /^[^/]+\/locale\/[^/]+\/[^/]+\.cfg$/i, "Factorio locale CFG", label);
  } else if (kind === "stardew") {
    const manifestEntries = requireMatch(errors, files, /^[^/]+\/manifest\.json$/i, "top-level SMAPI manifest.json", label);
    const manifest = await readJsonEntry(manifestEntries[0]);
    if (manifestEntries.length && (
      !String(manifest?.Name || "").trim() ||
      !String(manifest?.UniqueID || "").trim() ||
      !String(manifest?.Version || "").trim()
    )) {
      errors.push(`${label}: Stardew Valley manifest.json requires Name, UniqueID, and Version.`);
    }
    requireMatch(errors, files, /^[^/]+\/i18n\/[^/]+\.json$/i, "Stardew Valley i18n JSON", label);
  } else if (kind === "rimworld") {
    const aboutEntries = requireMatch(errors, files, /^[^/]+\/About\/About\.xml$/i, "RimWorld About/About.xml", label);
    if (aboutEntries.length) {
      const about = await aboutEntries[0].async("string");
      if (!/<ModMetaData>[\s\S]*<packageId>[^<]+<\/packageId>[\s\S]*<\/ModMetaData>/i.test(about)) {
        errors.push(`${label}: RimWorld About/About.xml has no valid packageId metadata.`);
      }
    }
    requireMatch(errors, files, /^[^/]+\/Languages\/[^/]+\/(?:Keyed|DefInjected)\/.+\.xml$/i, "RimWorld language XML", label);
  }

  return { valid: errors.length === 0, errors };
}

export async function assertNativeOutputLayout(zip, options) {
  const result = await validateNativeOutputLayout(zip, options);
  if (!result.valid) throw new Error(`Output validation failed: ${result.errors.join(" ")}`);
}
