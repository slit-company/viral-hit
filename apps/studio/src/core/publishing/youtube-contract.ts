import { z } from 'zod';

export const youtubeMetadataSchema = z.object({
  title: z.string().trim().min(1).max(100).refine(value => !/[<>]/.test(value), 'Title cannot contain angle brackets'),
  description: z.string().max(5000).refine(value => !/[<>]/.test(value), 'Description cannot contain angle brackets'),
  categoryId: z.string().regex(/^\d{1,10}$/),
  tags: z.array(z.string().trim().min(1).max(500)).max(100).default([]),
  privacy: z.enum(['private', 'unlisted', 'public']),
  madeForKids: z.boolean(),
  containsSyntheticMedia: z.boolean(),
  notifySubscribers: z.boolean(),
  publishAt: z.iso.datetime({ offset: true }).optional(),
}).strict().superRefine((value, context) => {
  const tagCharacters = value.tags.reduce((sum, tag) => sum + tag.length + (/\s/.test(tag) ? 2 : 0), Math.max(0, value.tags.length - 1));
  if (tagCharacters > 500) context.addIssue({ code: 'custom', path: ['tags'], message: 'Tags exceed the combined 500-character limit' });
  if (new TextEncoder().encode(value.description).length > 5000) context.addIssue({ code: 'custom', path: ['description'], message: 'Description exceeds 5,000 UTF-8 bytes' });
  if (value.publishAt && value.privacy !== 'private') context.addIssue({ code: 'custom', path: ['publishAt'], message: 'Scheduled YouTube uploads must initially be private' });
});
export type YouTubeMetadata = z.infer<typeof youtubeMetadataSchema>;

export type YouTubeReceipt = {
  videoId: string;
  channelId: string;
  privacy: 'private' | 'unlisted' | 'public';
  uploadStatus: 'uploaded' | 'processed' | 'failed' | 'rejected' | 'deleted';
  publishAt?: string;
  processingStatus?: 'processing' | 'succeeded' | 'failed' | 'terminated';
};
/** Acceptance of bytes does not imply processed video or public visibility. */
export type YouTubeUploadResult =
  | { kind: 'incomplete'; nextByte: number; retryAfterMs: number | null }
  | { kind: 'accepted'; receipt: YouTubeReceipt }
  | { kind: 'expired' };

export function youtubeResource(input: unknown, now = Date.now()) {
  const metadata = youtubeMetadataSchema.parse(input);
  if (metadata.publishAt && Date.parse(metadata.publishAt) <= now) throw new Error('Scheduled publication must be in the future');
  return {
    snippet: { title: metadata.title, description: metadata.description, categoryId: metadata.categoryId, ...(metadata.tags.length ? { tags: metadata.tags } : {}) },
    status: { privacyStatus: metadata.privacy, selfDeclaredMadeForKids: metadata.madeForKids, containsSyntheticMedia: metadata.containsSyntheticMedia, ...(metadata.publishAt ? { publishAt: metadata.publishAt } : {}) },
  };
}
