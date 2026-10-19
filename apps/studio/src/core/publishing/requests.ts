import { z } from 'zod';
import { youtubeMetadataSchema } from './youtube-contract';

export const publicationProjectId = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/);
const selected = { publicationId: z.uuid(), expectedRevision: z.number().int().positive() };
const draft = { connector: z.literal('youtube'), accountId: z.uuid(), assetId: z.string().regex(/^[a-zA-Z0-9_.-]{1,128}$/), metadata: youtubeMetadataSchema };
export const publicationRequest = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create'), requestKey: z.string().regex(/^[a-zA-Z0-9_.:-]{1,200}$/), ...draft }).strict(),
  z.object({ action: z.literal('revise'), ...selected, ...draft }).strict(),
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
