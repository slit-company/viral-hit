import { storyboardAttachment } from '@/core/storyboards/portable';
import { z } from 'zod';
import { canvasCardSchema } from '@/core/commands/schema';
import { normalizeProjectSnapshotDocument, type ProjectSnapshotDocument } from '../project-snapshot';
import { normalizeTimelineDocument, type TimelineDocument } from '@/core/editor/timeline-document';

export const MAX_BUNDLE_BYTES = 2 * 1024 * 1024 * 1024;
export const MAX_MANIFEST_BYTES = 5 * 1024 * 1024;
export const MAX_ASSET_BYTES = 512 * 1024 * 1024;
export const bundleId = z.string().uuid();
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,160}$/);
export const bundleAsset = z.object({
  id, filename: z.string().min(1).max(240), kind: z.enum(['image', 'video', 'audio']),
  mimeType: z.string().min(1).max(120), sizeBytes: z.number().int().positive().max(MAX_ASSET_BYTES),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  width: z.number().int().positive().max(100000).nullable(), height: z.number().int().positive().max(100000).nullable(),
  durationMs: z.number().int().positive().max(86400000).nullable(),
}).strict();
const snapshot = z.unknown().transform((value, ctx): ProjectSnapshotDocument => {
  try {
    if (!value || typeof value !== 'object' || (value as {version?: unknown}).version !== 3) throw Error('Unsupported Canvas version');
    const document = normalizeProjectSnapshotDocument(value);
    const raw = value as { cards?: unknown[]; frames?: Record<string, unknown> };
    if (!Array.isArray(raw.cards) || raw.cards.length !== document.cards.length || Object.keys(raw.frames ?? {}).length !== Object.keys(document.frames).length) throw Error('Canvas contains unsupported records');
    const cards = raw.cards.map(card => canvasCardSchema.parse(card));
    if (new Set(cards.map(card => card.id)).size !== cards.length) throw Error('Duplicate Canvas card ID');
    const ids = new Set(cards.map(card => card.id));
    for (const card of cards) {
      if ([...card.referenceCardIds, ...(card.generationSnapshot?.referenceCardIds ?? []), ...(card.sourceConfigCardId ? [card.sourceConfigCardId] : []), ...(card.pinnedOutputId ? [card.pinnedOutputId] : [])].some(value => !ids.has(value))) throw Error('Canvas has a missing card reference');
    }
    return { ...document, cards };
  } catch (error) { ctx.addIssue({ code: 'custom', message: error instanceof Error ? error.message : 'Invalid Canvas' }); return z.NEVER; }
});
const timeline = z.unknown().transform((value, ctx): TimelineDocument => {
  try { return normalizeTimelineDocument(value); }
  catch { ctx.addIssue({ code: 'custom', message: 'Invalid timeline' }); return z.NEVER; }
});
export const bundleManifest = z.object({
  format: z.literal('viral-hit-project'), version: z.union([z.literal(1), z.literal(2)]), createdAt: z.string().datetime(),
  project: z.object({ id, name: z.string().trim().min(1).max(240), workspaceMode: z.enum(['studio', 'canvas', 'editor', 'assets']), coverAssetId: id.nullable() }).strict(),
  revisions: z.object({ canvas: z.number().int().positive(), timeline: z.number().int().min(0) }).strict(),
  storyboards: storyboardAttachment.optional(),
  canvas: snapshot, timeline: timeline.nullable(), assets: z.array(bundleAsset).max(500),
}).strict().superRefine((value, ctx) => {
  if ((value.version === 2) !== (value.storyboards !== undefined)) ctx.addIssue({ code: 'custom', message: 'Storyboard attachment requires project format version 2' });
  if (new Set(value.assets.map(asset => asset.id)).size !== value.assets.length) ctx.addIssue({ code: 'custom', message: 'Duplicate asset ID' });
  if (value.assets.reduce((sum, asset) => sum + asset.sizeBytes, 0) > MAX_BUNDLE_BYTES - MAX_MANIFEST_BYTES - 1024 * 1024) ctx.addIssue({ code: 'custom', message: 'Project media exceeds the bundle limit' });
  if (value.timeline && value.timeline.projectId !== value.project.id) ctx.addIssue({ code: 'custom', message: 'Timeline belongs to another project' });
});
export type BundleManifest = z.infer<typeof bundleManifest>;
export const mediaMember = (hash: string) => `media/${hash}`;
