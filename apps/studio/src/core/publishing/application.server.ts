import { createHash } from 'node:crypto';
import { canonicalJson } from '../../lib/canonical-json';
import { getActiveProject } from '../projects/projects';
import { openPublications } from './publication-files.server';
import { openProjectPublicationMedia } from './project-media.server';
import { youtubeResource } from './youtube-contract';
import { publicationView } from './public-view';
import { publicationProjectId, publicationRequest, PublicationRequestError, type PublicationDraftRequest } from './requests';
import type { PublicationSpec } from './contracts';
import { publicationDestination, publishingConfigured, validateSupportedPublication } from './publication-destination.server';
import { InstagramVideoError, validateInstagramVideo } from './instagram-video.server';
export { publishingConfigured } from './publication-destination.server';

async function requireProject(projectId: string, signal: AbortSignal) {
  publicationProjectId.parse(projectId); signal.throwIfAborted();
  const project = await getActiveProject({ projectId });
  if (!project) throw new PublicationRequestError('not-found', 'Project not found');
  return project;
}
async function prepare(projectId: string, input: PublicationDraftRequest, signal: AbortSignal): Promise<PublicationSpec> {
  if (input.connector === 'youtube') validateSchedule(input.metadata);
  const destination = publicationDestination(input.connector, input.accountId), media = openProjectPublicationMedia();
  try {
    const asset = await media.pin(projectId, input.assetId, signal);
    const spec: PublicationSpec = { schemaVersion: 1, projectId, connector: input.connector, connectorVersion: '1',
      accountId: destination.id, destinationId: destination.destinationId, assets: [asset], metadata: input.metadata };
    validateSupportedPublication(spec);
    if (input.connector === 'instagram') validateInstagramVideo(await media.inspectVideo(spec, signal), asset.sizeBytes, input.metadata);
    const current = publicationDestination(input.connector, destination.id);
    if (current.destinationId !== destination.destinationId || current.pageId !== destination.pageId) throw new PublicationRequestError('account-unavailable', 'The destination changed while preparing this publication');
    await requireProject(projectId, signal); if (input.connector === 'youtube') validateSchedule(input.metadata);
    return spec;
  } catch (error) {
    if (error instanceof PublicationRequestError) throw error;
    if (error instanceof InstagramVideoError) throw new PublicationRequestError('media-unavailable', error.message);
    throw new PublicationRequestError('media-unavailable', 'Select an unchanged local MP4 or WebM video in this project');
  } finally { media.close(); }
}
function validateSchedule(metadata: unknown) {
  try { youtubeResource(metadata); }
  catch { throw new PublicationRequestError('invalid-input', 'Review the video metadata and choose a future publication time'); }
}
export async function listPublications(projectId: string, signal = AbortSignal.timeout(30000)) {
  const project = await requireProject(projectId, signal);
  const store = openPublications();
  try { return { project: { id: project.id, name: project.name }, configured: publishingConfigured(), connectors: { youtube: publishingConfigured(), instagram: publishingConfigured('instagram') }, publications: store.list(projectId).map(publicationView) }; }
  finally { store.close(); }
}
/** All transports share project/media/account admission and revision-bound approval. No provider POST occurs here. */
export async function changePublication(projectId: string, raw: unknown, actor: 'ui' | 'mcp' | 'cli', signal = AbortSignal.timeout(300000)) {
  const parsed = publicationRequest.safeParse(raw);
  if (!parsed.success) throw new PublicationRequestError('invalid-input', 'Invalid publication request');
  const input = parsed.data;
  await requireProject(projectId, signal);
  const store = openPublications();
  try {
    if (input.action === 'create') {
      const admissionDigest = createHash('sha256').update(canonicalJson({ projectId, ...input })).digest('hex');
      const prior = store.findRequest(projectId, input.requestKey);
      if (prior) {
        if (prior.admissionDigest !== admissionDigest) throw new PublicationRequestError('conflict', 'Publication request key is bound to different content');
        return publicationView(prior.record);
      }
      const spec = await prepare(projectId, input, signal);
      return publicationView(store.create(spec, input.requestKey, admissionDigest));
    }
    const prior = store.get(projectId, input.publicationId);
    if (!prior) throw new PublicationRequestError('not-found', 'Publication not found in this project');
    if (prior.revision !== input.expectedRevision) throw new PublicationRequestError('conflict', 'Publication changed; refresh before continuing');
    if (input.action === 'revise') return publicationView(store.revise(projectId, prior.id, input.expectedRevision, await prepare(projectId, input, signal)));
    if (input.action === 'approve' || input.action === 'resume') {
      if (!publishingConfigured(prior.spec.connector)) throw new PublicationRequestError('runtime-unavailable', 'Configure the selected publishing connector before approving delivery');
      validateSupportedPublication(prior.spec);
      const target = publicationDestination(prior.spec.connector, prior.spec.accountId);
      if (target.destinationId !== prior.spec.destinationId) throw new PublicationRequestError('account-unavailable', 'The original channel no longer matches this publication');
      const media = openProjectPublicationMedia();
      try { await media.validateAssets(prior.spec, signal); }
      catch { throw new PublicationRequestError('media-unavailable', 'The retained approved video is unavailable'); }
      finally { media.close(); }
      signal.throwIfAborted();
      // Resuming transfers bytes to the original session; its metadata is already remote.
      if (input.action === 'approve' && prior.spec.connector === 'youtube') validateSchedule(prior.spec.metadata);
      return publicationView(input.action === 'approve' ? store.approve(projectId, prior.id, input.expectedRevision, input.expectedDigest, actor) : store.resume(projectId, prior.id, input.expectedRevision));
    }
    return publicationView(input.action === 'stop' ? store.stop(projectId, prior.id, input.expectedRevision) : store.reconcile(projectId, prior.id, input.expectedRevision));
  } catch (error) {
    if (error instanceof PublicationRequestError) throw error;
    throw new PublicationRequestError('conflict', 'Publication could not be changed; refresh and review its current state');
  } finally { store.close(); }
}

/** Server-only snapshot for exact retained-video review, never a source path. */
export async function publicationForPreview(projectId: string, publicationId: string, digest: string, signal: AbortSignal) {
  await requireProject(projectId, signal);
  const store = openPublications();
  try {
    const record = store.get(projectId, publicationId);
    if (!record || record.digest !== digest) throw new PublicationRequestError('not-found', 'Reviewed publication not found');
    validateSupportedPublication(record.spec);
    return record.spec;
  } finally { store.close(); }
}
