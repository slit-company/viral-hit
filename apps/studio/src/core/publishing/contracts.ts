import { z } from 'zod';
import type { JsonValue } from '../../lib/canonical-json';

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
export type PublicationState = 'draft' | 'approved' | 'starting' | 'uploading' | 'accepted' | 'processing' | 'ready' | 'scheduled' | 'published' | 'reconciling' | 'uncertain' | 'failed' | 'canceled';
export type PublicationIssue = 'start-unknown' | 'upload-unknown' | 'session-expired' | 'remote-rejected' | 'runtime-unavailable' | 'asset-unavailable' | 'upload-incomplete' | 'stopped' | null;
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
export type RemoteObservation = { state: 'processing' | 'ready' | 'scheduled' | 'published' | 'failed'; receipt: JsonValue; retryAfterMs?: number };
/** Only use rejected/unavailable when no remote creation can have succeeded. */
export class PublicationStartError extends Error {
  constructor(readonly outcome: 'rejected' | 'unavailable', readonly retryAfterMs = 30000) { super('Publication start could not proceed'); }
}
export class PublicationAssetError extends Error {
  constructor() { super('Approved publication media is unavailable or changed'); }
}
export interface PublicationConnector {
  id: string; version: string;
  start(spec: PublicationSpec, signal: AbortSignal): Promise<JsonValue>;
  transfer(spec: PublicationSpec, checkpoint: JsonValue, read: (asset: number, offset: number, length: number) => Promise<Uint8Array>, signal: AbortSignal): Promise<TransferObservation>;
  reconcile(spec: PublicationSpec, checkpoint: JsonValue, signal: AbortSignal): Promise<TransferObservation>;
  inspect(spec: PublicationSpec, receipt: JsonValue, signal: AbortSignal): Promise<RemoteObservation>;
}
