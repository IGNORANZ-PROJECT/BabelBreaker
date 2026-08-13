export function supportsForcedBedrockOutput(project) {
  return Boolean(
    project &&
    ["bedrock_addon", "bedrock_world"].includes(project.artifactType) &&
    (project.documents || []).some((document) => document.format === "bedrock-lang"),
  );
}

export function bedrockLocalizationSummary(project) {
  const documents = (project?.documents || []).filter(
    (document) => document.format === "bedrock-lang",
  );
  const uncertain = documents.filter(
    (document) => !document.localizationEvidence?.confirmed,
  ).length;
  return { total: documents.length, uncertain, confirmed: documents.length - uncertain };
}

export function recommendedBedrockOutputMode(project) {
  // Existing locale files only describe the archive. They cannot prove that
  // an Add-on's scripts or UI will request the player's selected locale. The
  // source-replacement copy is therefore the reliable default, while the
  // non-destructive language-added copy remains available in the selector.
  return supportsForcedBedrockOutput(project) ? "forced" : "localized";
}
