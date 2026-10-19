import { z } from 'zod';
import { publicationAssetSchema, type PublicationRecord } from './contracts';
import { youtubeMetadataSchema } from './youtube-contract';

const receiptSchema = z.object({
  videoId: z.string().regex(/^[a-zA-Z0-9_-]{11}$/), channelId: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/),
  privacy: z.enum(['private', 'unlisted', 'public']), uploadStatus: z.enum(['uploaded', 'processed', 'failed', 'rejected', 'deleted']),
  publishAt: z.iso.datetime({ offset: true }).optional(), processingStatus: z.enum(['processing', 'succeeded', 'failed', 'terminated']).optional(),
});
export function publicationView(record: PublicationRecord) {
  const metadata = youtubeMetadataSchema.safeParse(record.spec.metadata), asset = publicationAssetSchema.safeParse(record.spec.assets[0]);
  const supported = record.spec.connector === 'youtube' && record.spec.connectorVersion === '1' && record.spec.assets.length === 1 && metadata.success && asset.success && ['video/mp4', 'video/webm'].includes(asset.data.contentType);
  const remote = receiptSchema.safeParse(record.receipt), progress = z.object({ nextByte: z.number().int().nonnegative() }).safeParse(record.checkpoint);
  const reviewed = record.approval?.digest === record.digest && record.approval.revision === record.revision;
  return {
    id: record.id, projectId: record.spec.projectId, connector: record.spec.connector, connectorVersion: record.spec.connectorVersion,
    accountId: record.spec.accountId, destinationId: record.spec.destinationId, revision: record.revision, digest: record.digest,
    state: record.state, issue: record.issue, createdAt: record.createdAt, updatedAt: record.updatedAt,
    supported: Boolean(supported), asset: supported ? asset.data! : null, metadata: supported ? metadata.data! : null,
    approvedAt: reviewed ? record.approval!.at : null,
    delivery: supported && remote.success && remote.data.channelId === record.spec.destinationId
      ? { ...remote.data, url: `https://www.youtube.com/watch?v=${remote.data.videoId}` } : null,
    bytesAccepted: supported && progress.success && progress.data.nextByte <= asset.data!.sizeBytes ? progress.data.nextByte : null,
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
