import { z } from 'zod';

/** Viewers watch the latest cut and comment; editors may also change the timeline. Owners use this computer. */
export const SHARE_ROLES = ['viewer', 'editor'] as const;
export type ShareRole = (typeof SHARE_ROLES)[number];
export const MAX_ACTIVE_SHARES = 20;
export const MAX_PROJECT_COMMENTS = 1000;

const text = (max: number) => z.string().trim().min(1).max(max);
const assetId = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
/** Where a comment points: a moment of the timeline, a clip, a project file, or the whole project. */
export const commentAnchor = z.object({
  time: z.number().finite().min(0).max(36_000).optional(),
  clipId: z.string().min(1).max(128).optional(),
  assetId: assetId.optional(),
}).strict();
export type CommentAnchor = z.infer<typeof commentAnchor>;

export const ownerCollaborationRequest = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list') }).strict(),
  z.object({ action: z.literal('share'), role: z.enum(SHARE_ROLES), label: text(60).optional() }).strict(),
  z.object({ action: z.literal('revoke'), shareId: z.string().uuid() }).strict(),
  z.object({ action: z.literal('comment'), body: text(2000), anchor: commentAnchor.default({}) }).strict(),
  z.object({ action: z.literal('resolve'), commentId: z.string().uuid(), resolved: z.boolean().default(true) }).strict(),
  z.object({ action: z.literal('delete'), commentId: z.string().uuid() }).strict(),
]);
export type OwnerCollaborationRequest = z.infer<typeof ownerCollaborationRequest>;

/** What a shared link can send besides timeline commands. The name is what others see; it is not an account. */
export const guestCollaborationRequest = z.discriminatedUnion('action', [
  z.object({ action: z.literal('comment'), name: text(60), body: text(2000), anchor: commentAnchor.default({}) }).strict(),
  z.object({ action: z.literal('resolve'), name: text(60), commentId: z.string().uuid(), resolved: z.boolean().default(true) }).strict(),
]);

export type CommentAuthorKind = 'owner' | 'agent' | 'guest';
export type CommentView = {
  id: string; body: string; author: string; authorKind: CommentAuthorKind; anchor: CommentAnchor;
  createdAt: number; resolvedAt: number | null; resolvedBy: string | null;
};
export type ShareView = { id: string; role: ShareRole; label: string | null; createdAt: number; lastUsedAt: number | null; revokedAt: number | null };
export type CollaborationView = { shares: ShareView[]; comments: CommentView[] };
export type SharedProjectView = {
  project: { id: string; name: string };
  role: ShareRole;
  /** The newest rendered cut of the timeline, when one exists. */
  cut: { url: string; durationMs: number | null; createdAt: number } | null;
  /** mine: written through this same link, so a viewer may settle it. */
  comments: (CommentView & { mine: boolean })[];
};
