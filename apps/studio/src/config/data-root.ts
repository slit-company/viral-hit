const resolveServerPath = (...segments: string[]) => {
  if (typeof process.getBuiltinModule !== 'function') {
    throw new Error('ViralHit data paths are only available in the local Node runtime.');
  }
  const path = process.getBuiltinModule('node:path') as typeof import('node:path');
  return path.resolve(...segments);
};

export const getViralHitDataRoot = (
  workspaceRoot = process.cwd(),
  configuredRoot = process.env.VIRAL_HIT_DATA_DIR?.trim()
) => {
  return configuredRoot
    ? resolveServerPath(configuredRoot)
    : resolveServerPath(workspaceRoot, 'data');
};

export const getViralHitDatabaseUrl = (
  workspaceRoot = process.cwd(),
  configuredRoot = process.env.VIRAL_HIT_DATA_DIR?.trim()
) => {
  return configuredRoot
    ? `file:${resolveServerPath(configuredRoot, 'local.db')}`
    : 'file:data/local.db';
};
