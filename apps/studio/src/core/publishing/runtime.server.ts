import { getActiveProject } from '../projects/projects';
import { openYouTubeAccounts } from './youtube-accounts.server';
import { openProjectPublicationMedia } from './project-media.server';
import { validateYouTubePublication } from './youtube-connector.server';
import type { PublicationRuntime } from './worker.server';

/** Account configuration is opened lazily: an empty or unconfigured queue stays offline. */
export function openPublicationRuntime(options: { fetch?: typeof fetch } = {}) {
  const media = openProjectPublicationMedia();
  let accounts: ReturnType<typeof openYouTubeAccounts> | undefined;
  const runtime: PublicationRuntime = {
    async connector(spec, signal) {
      signal.throwIfAborted(); validateYouTubePublication(spec);
      if (!await getActiveProject({ projectId: spec.projectId })) throw new Error('Project unavailable');
      accounts ??= openYouTubeAccounts({ fetch: options.fetch });
      const account = accounts.get(spec.accountId);
      if (!account || account.status !== 'connected' || account.channelId !== spec.destinationId) throw new Error('Original channel unavailable');
      signal.throwIfAborted(); return accounts.connector();
    },
    validateAssets: media.validateAssets,
    read: media.read,
  };
  return { ...runtime, close() { try { accounts?.close(); } finally { media.close(); } } };
}
