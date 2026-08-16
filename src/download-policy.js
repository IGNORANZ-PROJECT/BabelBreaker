export function requiresPreparedBatchDownload(project) {
  return Boolean(project?.artifactBatch || project?.isBatch);
}
