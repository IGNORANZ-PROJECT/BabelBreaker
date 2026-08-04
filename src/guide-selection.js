export function minecraftGuideModeForProject(project) {
  if (!project || (project.game || "minecraft") !== "minecraft") return "javaMod";
  if (project.artifactType === "modpack") return "modpack";
  if (project.artifactType === "java_world") return "javaWorld";
  if (project.artifactType === "data_pack") return "dataPack";
  if (project.artifactType === "server_plugin") return "serverPlugin";
  if (project.artifactType === "bedrock_world") return "bedrockWorld";
  if (project.artifactType === "bedrock_addon" || project.edition === "bedrock") {
    return "bedrockAddon";
  }
  if (project.artifactType === "resource_pack") return "javaResourcePack";
  return "javaMod";
}

function guideSelection(project) {
  const game = project?.game || "minecraft";
  return {
    game,
    minecraftMode: minecraftGuideModeForProject(project),
  };
}

function selectionKey(selection) {
  return selection.game === "minecraft"
    ? `${selection.game}:${selection.minecraftMode}`
    : selection.game;
}

export function selectGuideForProject(project) {
  const sourceProjects = Array.isArray(project?.sourceProjects)
    ? project.sourceProjects.filter(Boolean)
    : [];
  const projects = sourceProjects.length ? sourceProjects : [project].filter(Boolean);
  if (!projects.length) return guideSelection(null);

  const counts = new Map();
  const selections = new Map();
  for (const sourceProject of projects) {
    const selection = guideSelection(sourceProject);
    const key = selectionKey(selection);
    counts.set(key, (counts.get(key) || 0) + 1);
    if (!selections.has(key)) selections.set(key, selection);
  }

  let selectedKey = "";
  let selectedCount = -1;
  for (const [key, count] of counts) {
    if (count > selectedCount) {
      selectedKey = key;
      selectedCount = count;
    }
  }
  return selections.get(selectedKey) || guideSelection(null);
}
