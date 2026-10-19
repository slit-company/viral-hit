import { createHash } from 'node:crypto';
import { canonicalJson } from '../../lib/canonical-json';
import { getActiveProject } from '../projects/projects';
import { openPublishingAccountManagement } from './account-management.server';
import { openPublications } from './publication-files.server';
import { openProjectPublicationMedia } from './project-media.server';
import { googleOAuthEnvironment } from './youtube-accounts.server';
import { googleOAuthConfig } from './google-oauth.server';
import { YOUTUBE_CONNECTOR_VERSION, validateYouTubePublication } from './youtube-connector.server';
import { youtubeResource } from './youtube-contract';
import { publicationView } from './public-view';
import { publicationProjectId, publicationRequest, PublicationRequestError, type PublicationDraftRequest } from './requests';
import type { PublicationSpec } from './contracts';

export const publishingConfigured = () => { try { googleOAuthConfig(googleOAuthEnvironment()); return true; } catch { return false; } };
async function requireProject(projectId: string, signal: AbortSignal) {
  publicationProjectId.parse(projectId); signal.throwIfAborted();
  const project = await getActiveProject({ projectId });
  if (!project) throw new PublicationRequestError('not-found', 'Project not found');
  return project;
}
function account(accountId: string) {
  const accounts = openPublishingAccountManagement();
  try {
    const value = accounts.get(accountId);
    if (!value || value.provider !== 'youtube' || value.status !== 'connected') throw new PublicationRequestError('account-unavailable', 'Connect this YouTube channel before preparing or approving a publication');
    return value;
  } finally { accounts.close(); }
}
async function prepare(projectId: string, input: PublicationDraftRequest, signal: AbortSignal): Promise<PublicationSpec> {
  validateSchedule(input.metadata);
  const destination = account(input.accountId), media = openProjectPublicationMedia();
  try {
    const asset = await media.pin(projectId, input.assetId, signal);
    const spec: PublicationSpec = { schemaVersion: 1, projectId, connector: 'youtube', connectorVersion: YOUTUBE_CONNECTOR_VERSION,
      accountId: destination.id, destinationId: destination.channelId, assets: [asset], metadata: input.metadata };
    validateYouTubePublication(spec);
    const current = account(destination.id);
    if (current.channelId !== destination.channelId) throw new PublicationRequestError('account-unavailable', 'The channel changed while preparing this publication');
    await requireProject(projectId, signal); validateSchedule(input.metadata);
    return spec;
  } catch (error) {
    if (error instanceof PublicationRequestError) throw error;
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
  try { return { project: { id: project.id, name: project.name }, configured: publishingConfigured(), publications: store.list(projectId).map(publicationView) }; }
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
      if (!publishingConfigured()) throw new PublicationRequestError('runtime-unavailable', 'Configure Google OAuth before approving delivery');
      validateYouTubePublication(prior.spec);
      const target = account(prior.spec.accountId);
      if (target.channelId !== prior.spec.destinationId) throw new PublicationRequestError('account-unavailable', 'The original channel no longer matches this publication');
      const media = openProjectPublicationMedia();
      try { await media.validateAssets(prior.spec, signal); }
      catch { throw new PublicationRequestError('media-unavailable', 'The retained approved video is unavailable'); }
      finally { media.close(); }
      signal.throwIfAborted();
      // Resuming transfers bytes to the original session; its metadata is already remote.
      if (input.action === 'approve') validateSchedule(prior.spec.metadata);
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
    validateYouTubePublication(record.spec);
    return record.spec;
  } finally { store.close(); }
}
