import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { getViralHitDataRoot } from '../../config/data-root';
import { PublicationAccountError, type AccountTokens } from './account-contract';
import { PublicationAccountStore } from './account-store.server';
import { openCredentialVault } from './credential-vault.server';
import { createGoogleOAuth, type GoogleOAuthConfig } from './google-oauth.server';
import { createYouTubeTransport } from './youtube-transport.server';
import { createYouTubeConnector } from './youtube-connector.server';

const fingerprint = (value: string) => createHash('sha256').update(value).digest('hex');
function nonce(value: string) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{43,128}$/.test(value)) throw new PublicationAccountError('invalid-callback');
  return value;
}
export function googleOAuthEnvironment(): GoogleOAuthConfig {
  return { clientId: process.env.VIRAL_HIT_GOOGLE_CLIENT_ID ?? '', clientSecret: process.env.VIRAL_HIT_GOOGLE_CLIENT_SECRET ?? '', redirectUri: process.env.VIRAL_HIT_GOOGLE_REDIRECT_URI ?? '' };
}
type Options = { config?: GoogleOAuthConfig; root?: string; key?: string; fetch?: typeof fetch; now?: () => number };

/** Shared account application operations. HTTP must supply a private browser-binding cookie. */
export function openYouTubeAccounts(options: Options = {}) {
  const now = options.now ?? Date.now, oauth = createGoogleOAuth(options.config ?? googleOAuthEnvironment(), { fetch: options.fetch, now });
  const vault = openCredentialVault(options.root ?? resolve(getViralHitDataRoot(), 'publishing-accounts'), options.key ?? process.env.VIRAL_HIT_PUBLISHING_KEY);
  let store: PublicationAccountStore;
  try { store = new PublicationAccountStore(vault, now); } catch (error) { vault.close(); throw error; }
  async function channel(tokens: AccountTokens, signal: AbortSignal) {
    signal.throwIfAborted();
    const channels = await createYouTubeTransport({ accessToken: async () => tokens.accessToken, fetch: options.fetch }).ownedChannels(signal);
    if (channels.length !== 1) throw new PublicationAccountError('identity-mismatch');
    if (tokens.expiresAt <= now()) throw new PublicationAccountError('temporarily-unavailable');
    signal.throwIfAborted(); return channels[0];
  }
  async function accessToken(accountId: string, parent: AbortSignal) {
    parent.throwIfAborted();
    const lease = store.tokenOrLease(accountId, oauth.identity);
    if (lease.kind === 'cached') return lease.accessToken;
    const signal = AbortSignal.any([parent, AbortSignal.timeout(45000)]);
    try {
      const tokens = await oauth.refresh(lease.claim.tokens, signal);
      const target = await channel(tokens, signal);
      if (target.id !== lease.claim.channelId) throw new PublicationAccountError('identity-mismatch');
      if (!store.refreshed(lease.claim, tokens)) throw new PublicationAccountError('disconnected');
      return tokens.accessToken;
    } catch (error) {
      const safe = error instanceof PublicationAccountError ? error : new PublicationAccountError('temporarily-unavailable');
      store.refreshFailed(lease.claim, safe.code, ['grant-rejected', 'offline-unavailable', 'scope-missing', 'identity-mismatch'].includes(safe.code));
      throw safe;
    }
  }
  return {
    close() { store.close(); vault.close(); },
    list: () => store.list(),
    get: (accountId: string) => store.get(accountId),
    disconnect: (accountId: string, revision: number) => store.disconnect(accountId, revision),
    async begin(browserBinding: string, reconnect?: { accountId: string; revision: number }) {
      nonce(browserBinding);
      const flow = await oauth.begin();
      store.begin({ stateHash: fingerprint(flow.state), browserHash: fingerprint(browserBinding), accountId: reconnect?.accountId ?? randomUUID(),
        clientIdentity: oauth.identity, redirectUri: oauth.config.redirectUri, verifier: flow.verifier, expectedRevision: reconnect?.revision ?? null });
      return { authorizationUrl: flow.authorizationUrl, expiresAt: now() + 600000 };
    },
    async complete(callback: URL, browserBinding: string, parent: AbortSignal) {
      parent.throwIfAborted(); nonce(browserBinding);
      if (callback.href.length > 16384 || callback.searchParams.getAll('state').length !== 1) throw new PublicationAccountError('invalid-callback');
      const state = nonce(callback.searchParams.get('state') ?? '');
      const flow = store.consume(fingerprint(state), fingerprint(browserBinding), oauth.identity, oauth.config.redirectUri);
      const signal = AbortSignal.any([parent, AbortSignal.timeout(45000)]);
      try {
        const tokens = await oauth.exchange(callback, state, flow.verifier, signal);
        return store.connect(flow, await channel(tokens, signal), tokens);
      } catch (error) {
        store.failFlow(flow);
        throw error instanceof PublicationAccountError ? error : new PublicationAccountError('temporarily-unavailable');
      }
    },
    accessToken,
    connector: () => createYouTubeConnector({ accessToken, invalidateAccessToken: async (accountId, token) => store.invalidateToken(accountId, oauth.identity, token), fetch: options.fetch, now }),
  };
}
