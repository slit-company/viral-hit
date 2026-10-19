/** Only these built-ins emit project-owned, integrity-verified asset records. */
export function isAssetOperation(operation: string) {
  return ['asset.materialize', 'reference.youtube', 'reference.sample'].includes(operation);
}
export function assetOperationKind(operation: string, input: unknown): unknown {
  if (operation === 'reference.youtube' || operation === 'reference.sample') return 'video';
  return operation === 'asset.materialize' && input && typeof input === 'object' && 'kind' in input ? input.kind : null;
}
