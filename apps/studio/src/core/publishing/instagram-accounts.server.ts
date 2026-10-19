import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { getViralHitDataRoot } from '../../config/data-root';
import { PublicationAccountError } from './account-contract';
import { openCredentialVault } from './credential-vault.server';
import { InstagramAccountStore } from './instagram-account-store.server';
import { createMetaOAuth, type MetaOAuthConfig } from './meta-oauth.server';
import { createInstagramConnector } from './instagram-connector.server';

const fingerprint = (value: string) => createHash('sha256').update(value).digest('hex');
function nonce(value: string) { if (!/^[a-zA-Z0-9_-]{43,128}$/.test(value)) throw new PublicationAccountError('invalid-callback'); return value; }
export function metaOAuthEnvironment(): MetaOAuthConfig {
  return { clientId: process.env.VIRAL_HIT_META_APP_ID ?? '', clientSecret: process.env.VIRAL_HIT_META_APP_SECRET ?? '', configurationId: process.env.VIRAL_HIT_META_LOGIN_CONFIG_ID ?? '', redirectUri: process.env.VIRAL_HIT_META_REDIRECT_URI ?? '' };
}
type StorageOptions = { root?: string; key?: string; now?: () => number };
/** Local disconnect/list work even if Meta configuration is removed or rotated. */
export function openInstagramAccountManagement(options: StorageOptions = {}) {
  const vault = openCredentialVault(options.root ?? resolve(getViralHitDataRoot(), 'publishing-accounts', 'instagram'), options.key ?? process.env.VIRAL_HIT_PUBLISHING_KEY);
  let store: InstagramAccountStore;
  try { store = new InstagramAccountStore(vault, options.now); } catch (error) { vault.close(); throw error; }
  return { store, list: () => store.list(), get: (id: string) => store.get(id), disconnect: (id: string, revision: number) => store.disconnect(id, revision), close() { store.close(); vault.close(); } };
}

export function openInstagramAccounts(options: StorageOptions & { config?: MetaOAuthConfig; fetch?: typeof fetch } = {}) {
  const now = options.now ?? Date.now, oauth = createMetaOAuth(options.config ?? metaOAuthEnvironment(), { fetch: options.fetch, now });
  const management = openInstagramAccountManagement(options), store = management.store;
  return {
    close: management.close, list: management.list, get: management.get, disconnect: management.disconnect,
    begin(browserBinding: string, reconnect?: { accountId: string; revision: number }) {
      nonce(browserBinding); const flow = oauth.begin();
      store.begin({ stateHash: fingerprint(flow.state), browserHash: fingerprint(browserBinding), clientIdentity: oauth.identity, redirectUri: oauth.config.redirectUri, accountId: reconnect?.accountId ?? randomUUID(), expectedRevision: reconnect?.revision ?? null });
      return { authorizationUrl: flow.authorizationUrl, expiresAt: now() + 600000 };
    },
    async complete(callback: URL, browserBinding: string, parent: AbortSignal) {
      parent.throwIfAborted(); nonce(browserBinding);
      if (callback.href.length > 16384 || callback.searchParams.getAll('state').length !== 1) throw new PublicationAccountError('invalid-callback');
      const state = nonce(callback.searchParams.get('state') ?? '');
      const claim = store.consume(fingerprint(state), fingerprint(browserBinding), oauth.identity, oauth.config.redirectUri);
      try {
        const signal = AbortSignal.any([parent, AbortSignal.timeout(45000)]);
        const candidates = await oauth.exchange(callback, state, signal); signal.throwIfAborted();
        store.stage(claim, candidates); return { state };
      } catch (error) { store.fail(claim); throw error instanceof PublicationAccountError ? error : new PublicationAccountError('temporarily-unavailable'); }
    },
    selection(state: string, browserBinding: string) { return store.selection(fingerprint(nonce(state)), fingerprint(nonce(browserBinding)), oauth.identity); },
    cancel(state: string, browserBinding: string) { return store.cancel(fingerprint(nonce(state)), fingerprint(nonce(browserBinding)), oauth.identity); },
    async select(state: string, browserBinding: string, pageId: string, parent: AbortSignal) {
      parent.throwIfAborted();
      const { claim, grant } = store.claimSelection(fingerprint(nonce(state)), fingerprint(nonce(browserBinding)), oauth.identity, pageId);
      try {
        const signal = AbortSignal.any([parent, AbortSignal.timeout(45000)]);
        const verified = await oauth.verifyGrant(grant, signal); signal.throwIfAborted();
        return store.connect(claim, verified);
      } catch (error) { store.fail(claim); throw error instanceof PublicationAccountError ? error : new PublicationAccountError('temporarily-unavailable'); }
    },
    connector: () => createInstagramConnector({
      credential: async (id, signal) => { signal.throwIfAborted(); const grant = store.credential(id, oauth.identity); return { pageId: grant.pageId, instagramId: grant.instagramId, accessToken: grant.accessToken, revision: grant.revision }; },
      fetch: options.fetch, invalidateCredential: async (id, token, revision) => store.invalidate(id, oauth.identity, token, revision),
    }),
  };
}
