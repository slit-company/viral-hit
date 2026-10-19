import { z } from 'zod';

export type AccountIssue = 'configuration' | 'invalid-callback' | 'denied' | 'grant-rejected' | 'offline-unavailable' | 'scope-missing' | 'temporarily-unavailable' | 'identity-mismatch' | 'disconnected' | 'busy' | 'vault-unavailable';
export class PublicationAccountError extends Error {
  constructor(readonly code: AccountIssue) { super(`Publishing account: ${code}`); }
}
export type PublicationAccount = {
  id: string; provider: 'youtube'; channelId: string; channelTitle: string;
  status: 'connected' | 'reconnect-required' | 'disconnected'; revision: number;
  issue: AccountIssue | null; updatedAt: number;
};
const token = z.string().min(1).max(8192).regex(/^\S+$/);
export const accountTokensSchema = z.object({
  accessToken: token, refreshToken: token, expiresAt: z.number().int().positive(),
  refreshExpiresAt: z.number().int().positive().nullable(),
  scopes: z.array(z.string().min(1).max(1000)).min(1).max(64),
}).strict();
export type AccountTokens = z.infer<typeof accountTokensSchema>;
