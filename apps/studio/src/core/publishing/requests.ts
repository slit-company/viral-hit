import { z } from 'zod';
import { youtubeMetadataSchema } from './youtube-contract';
import { instagramMetadataSchema } from './instagram-contract';
import { installedConnectorId } from './installed/contract';

export const publicationProjectId = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/);
const selected = { publicationId: z.uuid(), expectedRevision: z.number().int().positive() };
const fields = { accountId: z.uuid(), assetId: z.string().regex(/^[a-zA-Z0-9_.-]{1,128}$/) };
const youtube = { ...fields, connector: z.literal('youtube'), metadata: youtubeMetadataSchema };
const installed = { connector: installedConnectorId, accountId: z.string().regex(/^[a-zA-Z0-9_.-]{1,128}$/), assetIds: z.array(fields.assetId).min(1).max(20).refine(ids => new Set(ids).size === ids.length, 'Choose each asset once'), metadata: z.record(z.string(), z.json()) };
const instagram = { ...fields, connector: z.literal('instagram'), metadata: instagramMetadataSchema };
const create = { action: z.literal('create'), requestKey: z.string().regex(/^[a-zA-Z0-9_.:-]{1,200}$/) };
const revise = { action: z.literal('revise'), ...selected };
export const publicationRequest = z.union([
  z.object({ ...create, ...youtube }).strict(), z.object({ ...create, ...instagram }).strict(),
  z.object({ ...create, ...installed }).strict(), z.object({ ...revise, ...installed }).strict(),
  z.object({ ...revise, ...youtube }).strict(), z.object({ ...revise, ...instagram }).strict(),
  z.object({ action: z.literal('approve'), ...selected, expectedDigest: z.string().regex(/^[a-f0-9]{64}$/), confirmed: z.literal(true) }).strict(),
  z.object({ action: z.literal('stop'), ...selected }).strict(),
  z.object({ action: z.literal('reconcile'), ...selected }).strict(),
  z.object({ action: z.literal('resume'), ...selected, confirmed: z.literal(true) }).strict(),
]);
export type PublicationRequest = z.infer<typeof publicationRequest>;
export type PublicationDraftRequest = Extract<PublicationRequest, { action: 'create' | 'revise' }>;
export class PublicationRequestError extends Error {
  constructor(readonly code: 'not-found' | 'conflict' | 'invalid-input' | 'account-unavailable' | 'media-unavailable' | 'runtime-unavailable', message: string) { super(message); }
}
