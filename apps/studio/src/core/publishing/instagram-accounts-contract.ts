import { z } from 'zod';
import type { AccountIssue } from './account-contract';
import { instagramIdSchema } from './instagram-contract';

export type InstagramAccount = {
  id: string; provider: 'instagram'; instagramId: string; pageId: string; pageName: string; username: string;
  status: 'connected' | 'reconnect-required' | 'disconnected'; revision: number; issue: AccountIssue | null; updatedAt: number;
};
export const instagramGrantSchema = z.object({
  pageId: instagramIdSchema, instagramId: instagramIdSchema,
  pageName: z.string().max(1000), username: z.string().max(1000),
  accessToken: z.string().min(1).max(8192).regex(/^\S+$/),
  expiresAt: z.number().int().positive().nullable(), userId: instagramIdSchema,
}).strict();
export type InstagramGrant = z.infer<typeof instagramGrantSchema>;
export type InstagramCandidate = Pick<InstagramGrant, 'pageId' | 'instagramId' | 'pageName' | 'username'>;
export function instagramCandidate(grant: InstagramGrant): InstagramCandidate {
  return { pageId: grant.pageId, instagramId: grant.instagramId, pageName: grant.pageName, username: grant.username };
}
export const instagramAccountRequest = z.discriminatedUnion('action', [
  z.object({ action: z.literal('connect'), reconnect: z.object({ accountId: z.uuid(), revision: z.number().int().positive() }).strict().optional() }).strict(),
  z.object({ action: z.literal('disconnect'), accountId: z.uuid(), revision: z.number().int().positive() }).strict(),
  z.object({ action: z.literal('select'), state: z.string().regex(/^[a-zA-Z0-9_-]{43,128}$/), pageId: instagramIdSchema }).strict(),
  z.object({ action: z.literal('cancel'), state: z.string().regex(/^[a-zA-Z0-9_-]{43,128}$/) }).strict(),
]);
export type InstagramAccountRequest = z.infer<typeof instagramAccountRequest>;
export type InstagramSelection = { candidates: InstagramCandidate[]; expiresAt: number };
