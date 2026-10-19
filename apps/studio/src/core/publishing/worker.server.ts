import { PublicationAssetError, PublicationStartError, type PublicationConnector, type PublicationSpec, type TransferObservation } from './contracts';
import type { PublicationStore } from './store.server';

export type PublicationRuntime = {
  connector(spec: PublicationSpec, signal: AbortSignal): Promise<PublicationConnector>;
  /** Verify all approved content before creating any remote object. Bounded streaming only. */
  validateAssets(spec: PublicationSpec, signal: AbortSignal): Promise<void>;
  /** Return exact, integrity-checked bytes for the approved asset, never an arbitrary path. */
  read(spec: PublicationSpec, asset: number, offset: number, length: number, signal: AbortSignal): Promise<Uint8Array>;
};

/** One bounded action per lease. All runtime implementations must honor cancellation. */
export async function runPublicationStep(store: PublicationStore, runtime: PublicationRuntime, parentSignal?: AbortSignal) {
  parentSignal?.throwIfAborted();
  const claim = store.claim();
  if (!claim) return null;
  const signal = parentSignal ? AbortSignal.any([parentSignal, AbortSignal.timeout(55000)]) : AbortSignal.timeout(55000);
  const finish: PublicationStore['finish'] = (record, state, patch) => store.finish(record, state, patch);
  if (claim.approval?.digest !== claim.digest || claim.approval.revision !== claim.revision) {
    finish(claim, 'uncertain', { issue: 'runtime-unavailable' });
    return store.get(claim.spec.projectId, claim.id);
  }
  // A prior owner may have sent POST and died before storing its response.
  if (claim.state === 'starting') {
    finish(claim, 'uncertain', { issue: 'start-unknown' });
    return store.get(claim.spec.projectId, claim.id);
  }
  let connector: PublicationConnector;
  try {
    connector = await runtime.connector(claim.spec, signal);
    if (connector.id !== claim.spec.connector || connector.version !== claim.spec.connectorVersion) throw new Error('Runtime identity changed');
    signal.throwIfAborted();
  } catch {
    finish(claim, claim.state, { issue: 'runtime-unavailable', delayMs: 30000 });
    return store.get(claim.spec.projectId, claim.id);
  }
  let starting = false;
  const transferred = (observation: TransferObservation, readOnly = false) => {
    if (observation.kind === 'accepted') finish(claim, 'accepted', { receipt: observation.receipt });
    else if (observation.kind === 'uncertain') finish(claim, 'uncertain', { issue: observation.issue });
    else finish(claim, readOnly ? 'uncertain' : 'uploading', {
      checkpoint: observation.checkpoint, issue: readOnly ? 'upload-incomplete' : null, delayMs: observation.retryAfterMs,
    });
  };
  try {
    if (claim.state === 'approved') {
      try { await runtime.validateAssets(claim.spec, signal); }
      catch { throw new PublicationAssetError(); }
      signal.throwIfAborted();
      if (!store.begin(claim)) return store.get(claim.spec.projectId, claim.id);
      starting = true;
      const checkpoint = await connector.start(claim.spec, signal);
      // Never send bytes until this checkpoint has survived its own commit.
      store.checkpoint(claim, checkpoint);
    } else if (claim.receipt !== null) {
      const observation = await connector.inspect(claim.spec, claim.receipt, signal);
      finish(claim, observation.state, { receipt: observation.receipt, issue: observation.state === 'failed' ? 'remote-rejected' : null, delayMs: observation.retryAfterMs ?? 30000 });
    } else if (claim.checkpoint !== null && claim.state === 'reconciling') {
      transferred(await connector.reconcile(claim.spec, claim.checkpoint, signal), true);
    } else if (claim.checkpoint !== null && claim.state === 'uploading') {
      const read = async (asset: number, offset: number, length: number) => {
        signal.throwIfAborted();
        try { return await runtime.read(claim.spec, asset, offset, length, signal); }
        catch { throw new PublicationAssetError(); }
      };
      transferred(await connector.transfer(claim.spec, claim.checkpoint, read, signal));
    } else finish(claim, 'uncertain', { issue: 'upload-unknown' });
  } catch (error) {
    if (error instanceof PublicationAssetError) finish(claim, claim.state === 'approved' && !starting ? 'approved' : 'uncertain', { issue: 'asset-unavailable', delayMs: 30000 });
    else if (starting) {
      if (error instanceof PublicationStartError) finish(claim, error.outcome === 'rejected' ? 'failed' : 'approved', {
        issue: error.outcome === 'rejected' ? 'remote-rejected' : 'runtime-unavailable', delayMs: error.retryAfterMs,
      });
      else finish(claim, 'uncertain', { issue: 'start-unknown' });
    } else {
      // Known session/receipt survives errors. The next upload action must probe first.
      finish(claim, claim.state, { issue: 'upload-unknown', delayMs: 30000 });
    }
  }
  return store.get(claim.spec.projectId, claim.id);
}
