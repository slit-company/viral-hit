import type { ExternalPublicationReview } from './installed/contract';
import { z } from 'zod';
import { publicationAssetSchema, type PublicationRecord } from './contracts';
import { instagramPostCheckpointSchema, instagramPostReceiptSchema, instagramReceiptSchema } from './instagram-contract';
import { instagramFormat } from './instagram-format';
import { youtubeMetadataSchema } from './youtube-contract';

const receiptSchema = z.object({
  videoId: z.string().regex(/^[a-zA-Z0-9_-]{11}$/), channelId: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/),
  privacy: z.enum(['private', 'unlisted', 'public']), uploadStatus: z.enum(['uploaded', 'processed', 'failed', 'rejected', 'deleted']),
  publishAt: z.iso.datetime({ offset: true }).optional(), processingStatus: z.enum(['processing', 'succeeded', 'failed', 'terminated']).optional(),
});
/** Container status for Reels/video Stories and for multi-container posts; never raw receipts. */
function instagramDelivery(record: PublicationRecord) {
  const video = instagramReceiptSchema.safeParse(record.receipt), post = instagramPostReceiptSchema.safeParse(record.receipt);
  const remote = video.success ? { ...video.data, items: 1 } : post.success ? { ...post.data, containerId: post.data.containerId ?? null, items: post.data.items.length } : null;
  if (!remote || remote.instagramId !== record.spec.destinationId) return null;
  return { containerId: remote.containerId, items: remote.items, instagramId: remote.instagramId, pageId: remote.pageId, status: remote.status, ...(remote.mediaId ? { mediaId: remote.mediaId } : {}) };
}
export function publicationView(record: PublicationRecord, external?: ExternalPublicationReview) {
  const metadata = youtubeMetadataSchema.safeParse(record.spec.metadata), asset = publicationAssetSchema.safeParse(record.spec.assets[0]);
  const youtubeSupported = record.spec.connector === 'youtube' && record.spec.connectorVersion === '1' && record.spec.assets.length === 1 && metadata.success && asset.success && ['video/mp4', 'video/webm'].includes(asset.data.contentType);
  const instagram = record.spec.connector === 'instagram' && record.spec.connectorVersion === '1' && record.spec.assets.every(item => publicationAssetSchema.safeParse(item).success) ? instagramFormat(record.spec) : null;
  const instagramSupported = Boolean(instagram);
  const supported = youtubeSupported || instagramSupported || Boolean(external);
  const remote = receiptSchema.safeParse(record.receipt), progress = z.object({ nextByte: z.number().int().nonnegative() }).safeParse(record.checkpoint);
  const posted = instagramPostCheckpointSchema.safeParse(record.checkpoint);
  // Multi-item posts transfer only their videos; images are downloaded by Meta.
  const videoBytes = record.spec.assets.filter(item => item.contentType.startsWith('video/')).reduce((sum, item) => sum + item.sizeBytes, 0);
  const bytesTotal = instagram?.post ? videoBytes || null : supported && asset.success ? asset.data.sizeBytes : null;
  const bytesAccepted = !supported ? null : posted.success ? (bytesTotal ? Math.min(bytesTotal, posted.data.items.reduce((sum, item) => sum + (item.nextByte ?? 0), 0)) : null)
    : progress.success && asset.success && progress.data.nextByte <= asset.data.sizeBytes ? progress.data.nextByte : null;
  const reviewed = record.approval?.digest === record.digest && record.approval.revision === record.revision;
  return {
    id: record.id, projectId: record.spec.projectId, connector: record.spec.connector, connectorVersion: record.spec.connectorVersion,
    accountId: record.spec.accountId, destinationId: record.spec.destinationId, revision: record.revision, digest: record.digest,
    state: record.state, issue: record.issue, createdAt: record.createdAt, updatedAt: record.updatedAt,
    external: external ?? null, supported: Boolean(supported), asset: supported ? asset.data! : null, assets: supported ? record.spec.assets : [], metadata: youtubeSupported ? metadata.data! : null,
    instagramMetadata: instagram?.metadata ?? null,
    instagramDelivery: instagramSupported ? instagramDelivery(record) : null,
    approvedAt: reviewed ? record.approval!.at : null,
    delivery: youtubeSupported && remote.success && remote.data.channelId === record.spec.destinationId
      ? { ...remote.data, url: `https://www.youtube.com/watch?v=${remote.data.videoId}` } : null,
    bytesAccepted, bytesTotal,
    actions: {
      revise: Boolean(supported && ['draft', 'approved'].includes(record.state)),
      approve: Boolean(supported && record.state === 'draft'),
      stop: !['published', 'ready', 'failed', 'canceled'].includes(record.state),
      reconcile: record.state === 'uncertain' && (record.checkpoint !== null || record.receipt !== null),
      resume: Boolean(supported && record.state === 'uncertain' && record.issue === 'upload-incomplete' && record.checkpoint !== null && reviewed),
    },
  };
}
export type PublicationView = ReturnType<typeof publicationView>;
