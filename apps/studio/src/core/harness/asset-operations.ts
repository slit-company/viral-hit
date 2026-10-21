/** Only these built-ins emit project-owned, integrity-verified asset records. */
export function isAssetOperation(operation: string, input?: unknown) {
  if (operation === 'generation.model') return assetOperationKind(operation, input) !== null;
  return [ 'asset.materialize', 'reference.youtube', 'reference.sample', 'reference.scenes'].includes(operation);
}
export function assetOperationKind(operation: string, input: unknown): unknown {
  if (operation === 'generation.model') return input && typeof input === 'object' && 'mode' in input && ['image', 'video', 'audio'].includes(String(input.mode)) ? input.mode : null;
  if (operation === 'reference.youtube' || operation === 'reference.sample' || operation === 'reference.scenes') return 'video';
  return operation === 'asset.materialize' && input && typeof input === 'object' && 'kind' in input ? input.kind : null;
}

export function isAssetJob(job: { operation: string; input_json: string }) {
  if (job.operation !== 'generation.model') return isAssetOperation(job.operation);
  try { return isAssetOperation(job.operation, JSON.parse(job.input_json)); } catch { return false; }
}
