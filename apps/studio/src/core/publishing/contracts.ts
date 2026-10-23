import { z } from 'zod';
import type { JsonValue } from '../../lib/canonical-json';
import type { MeasurementResult } from '../measurement/contract';

const id = z.string().regex(/^[a-zA-Z0-9_.-]{1,128}$/);
export const publicationAssetSchema = z.object({
  assetId: id, sha256: z.string().regex(/^[a-f0-9]{64}$/),
  sizeBytes: z.number().int().positive().max(256 * 1024 ** 3),
  contentType: z.string().regex(/^(image|video|audio)\/[a-z0-9.+-]{1,80}$/),
}).strict();
export type PublicationAsset = z.infer<typeof publicationAssetSchema>;
export const publicationSpecSchema = z.object({
  schemaVersion: z.literal(1), projectId: id,
  connector: id, connectorVersion: z.string().min(1).max(80),
  accountId: id, destinationId: id,
  assets: z.array(publicationAssetSchema).min(1).max(20),
  metadata: z.json(),
}).strict();
export type PublicationSpec = z.infer<typeof publicationSpecSchema>;
export type PublicationState = 'draft' | 'approved' | 'starting' | 'uploading' | 'accepted' | 'processing' | 'staged' | 'publishing' | 'ready' | 'scheduled' | 'published' | 'reconciling' | 'uncertain' | 'failed' | 'canceled';
export type PublicationIssue = 'start-unknown' | 'upload-unknown' | 'publish-unknown' | 'session-expired' | 'remote-rejected' | 'runtime-unavailable' | 'asset-unavailable' | 'upload-incomplete' | 'stopped' | 'processing-timeout' | null;
export type PublicationApproval = { digest: string; revision: number; actor: string; at: number };
export type PublicationRecord = {
  id: string; spec: PublicationSpec; digest: string; revision: number; state: PublicationState;
  approval: PublicationApproval | null; checkpoint: JsonValue | null; receipt: JsonValue | null;
  issue: PublicationIssue; nextPoll: number; leaseToken: string | null; leaseUntil: number;
  createdAt: number; updatedAt: number;
};
/** Credentials, sessions and raw connector receipts never enter the generic browser view. */
export function publicPublication(record: PublicationRecord) {
  const { checkpoint: _, receipt: __, leaseToken: ___, leaseUntil: ____, ...view } = record;
  return view;
}
export type TransferObservation =
  | { kind: 'progress'; checkpoint: JsonValue; retryAfterMs?: number }
  | { kind: 'accepted'; receipt: JsonValue }
  | { kind: 'uncertain'; issue: 'session-expired' | 'upload-unknown' };
export type RemoteObservation = { state: 'processing' | 'staged' | 'ready' | 'scheduled' | 'published' | 'failed'; receipt: JsonValue; retryAfterMs?: number };
/** A connector may pause bounded read-only polling without losing the original receipt. */
export class PublicationInspectionPaused extends Error {
  constructor(readonly receipt: JsonValue) { super('Remote processing still needs confirmation'); }
}
/** Only throw before a non-idempotent write; the durable worker can safely defer the same phase. */
export class PublicationDeferred extends Error {
  constructor(readonly until: number) {
    super('Publication is waiting for its approved time');
    if (!Number.isSafeInteger(until) || until < 0) throw new Error('Invalid publication deferral');
  }
}
/** Only use rejected/unavailable when no remote creation can have succeeded. */
export class PublicationStartError extends Error {
  constructor(readonly outcome: 'rejected' | 'unavailable', readonly retryAfterMs = 30000) { super('Publication start could not proceed'); }
}
export class PublicationAssetError extends Error {
  constructor() { super('Approved publication media is unavailable or changed'); }
}
/** Use only when final publication is known not to have happened. All other errors are ambiguous. */
export class PublicationPublishError extends Error {
  constructor(readonly outcome: 'rejected' | 'unavailable', readonly retryAfterMs = 60000) { super('Publication could not proceed'); }
}
export interface PublicationConnector {
  id: string; version: string;
  /** Pure UTC millisecond gate. Provider-specific preparation policy stays in the connector. */
  notBefore?(spec: PublicationSpec, phase: 'start' | 'publish'): number | null;
  start(spec: PublicationSpec, signal: AbortSignal): Promise<JsonValue>;
  transfer(spec: PublicationSpec, checkpoint: JsonValue, read: (asset: number, offset: number, length: number) => Promise<Uint8Array>, signal: AbortSignal): Promise<TransferObservation>;
  reconcile(spec: PublicationSpec, checkpoint: JsonValue, signal: AbortSignal): Promise<TransferObservation>;
  /** Read-only, including while recovering a stopped or ambiguous write. */
  inspect(spec: PublicationSpec, receipt: JsonValue, signal: AbortSignal): Promise<RemoteObservation>;
  /** Optional second non-idempotent write, called only after a committed publishing fence. */
  publish?(spec: PublicationSpec, receipt: JsonValue, signal: AbortSignal): Promise<RemoteObservation>;
  /** Optional read-only performance reading for a delivered publication. Throw MeasurementUnavailable when nothing could be read. */
  measure?(spec: PublicationSpec, receipt: JsonValue, signal: AbortSignal): Promise<MeasurementResult>;
}
