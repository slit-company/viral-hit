import { z } from 'zod';
import type { PublicationAccount } from './account-contract';

const selected = z.object({ accountId: z.uuid(), revision: z.number().int().positive() }).strict();
export const accountRequest = z.discriminatedUnion('action', [
  z.object({ action: z.literal('connect'), reconnect: selected.optional() }).strict(),
  z.object({ action: z.literal('disconnect'), ...selected.shape }).strict(),
]);
export type AccountRequest = z.infer<typeof accountRequest>;
export type AccountAvailability = 'ready' | 'configuration' | 'origin-mismatch';
export type AccountSnapshot = { accounts: PublicationAccount[]; youtube: AccountAvailability };
export type ConnectResult = { authorizationUrl: string; expiresAt: number };
