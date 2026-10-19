import { createHash, createHmac, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { PublicationAccountError } from './account-contract';
import { instagramIdSchema } from './instagram-contract';
import { instagramGrantSchema, type InstagramGrant } from './instagram-accounts-contract';
import { instagramJson } from './instagram-http.server';
import { INSTAGRAM_GRAPH_VERSION } from './instagram-transport.server';

export const INSTAGRAM_OAUTH_SCOPES = ['instagram_basic', 'instagram_content_publish', 'pages_read_engagement', 'pages_show_list'];
export type MetaOAuthConfig = { clientId: string; clientSecret: string; configurationId: string; redirectUri: string };
export function metaOAuthConfig(raw: MetaOAuthConfig) {
  if (!instagramIdSchema.safeParse(raw.clientId).success || !instagramIdSchema.safeParse(raw.configurationId).success || !raw.clientSecret || raw.clientSecret.length > 8192 || /\s/.test(raw.clientSecret)) throw new PublicationAccountError('configuration');
  let redirect: URL;
  try { redirect = new URL(raw.redirectUri); } catch { throw new PublicationAccountError('configuration'); }
  const loopback = ['127.0.0.1', '[::1]', 'localhost'].includes(redirect.hostname);
  if ((redirect.protocol !== 'https:' && !(redirect.protocol === 'http:' && loopback)) || redirect.username || redirect.password || redirect.search || redirect.hash || redirect.pathname !== '/api/app/publishing/instagram/callback') throw new PublicationAccountError('configuration');
  return { ...raw, redirectUri: redirect.href };
}
const tokenSchema = z.object({ access_token: z.string().min(1).max(8192).regex(/^\S+$/), token_type: z.string().regex(/^bearer$/i), expires_in: z.number().int().positive().max(366 * 86400) });
const inspectedSchema = z.object({ data: z.object({ app_id: z.union([instagramIdSchema, z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).transform(String)]), type: z.enum(['USER', 'PAGE']), is_valid: z.boolean(), user_id: instagramIdSchema.optional(), expires_at: z.number().int().nonnegative(), data_access_expires_at: z.number().int().nonnegative().optional(), scopes: z.array(z.string()).max(128) }) });
const pageSchema = z.object({ id: instagramIdSchema, name: z.string().max(1000), access_token: z.string().min(1).max(8192), instagram_business_account: z.object({ id: instagramIdSchema, username: z.string().max(1000).optional() }).optional(), tasks: z.array(z.string()).optional() });
const pagesSchema = z.object({ data: z.array(pageSchema).max(20), paging: z.object({ next: z.string().optional(), cursors: z.object({ after: z.string().min(1).max(4096).regex(/^[a-zA-Z0-9_=+-]+$/) }).optional() }).optional() });
const safe = (error: unknown) => error instanceof PublicationAccountError ? error : new PublicationAccountError('temporarily-unavailable');

export function createMetaOAuth(raw: MetaOAuthConfig, options: { fetch?: typeof fetch; now?: () => number } = {}) {
  const config = metaOAuthConfig(raw), request = options.fetch ?? fetch, now = options.now ?? Date.now;
  const identity = createHash('sha256').update(`facebook-login-business\n${config.clientId}\n${config.configurationId}`).digest('hex');
  async function get(path: string, params: Record<string, string>, bearer: string | null, parent: AbortSignal) {
    const signal = AbortSignal.any([parent, AbortSignal.timeout(15000)]); signal.throwIfAborted();
    const url = new URL(`https://graph.facebook.com/${INSTAGRAM_GRAPH_VERSION}/${path}`); url.search = new URLSearchParams(params).toString();
    try { return await instagramJson(await request(url.href, { method: 'GET', signal, redirect: 'error', credentials: 'omit', headers: bearer ? { authorization: `Bearer ${bearer}` } : {} }), signal); }
    catch { throw new PublicationAccountError('temporarily-unavailable'); }
  }
  const proof = (token: string) => createHmac('sha256', config.clientSecret).update(token).digest('hex');
  async function inspect(token: string, type: 'USER' | 'PAGE', signal: AbortSignal) {
    const result = inspectedSchema.parse(await get('debug_token', { input_token: token }, `${config.clientId}|${config.clientSecret}`, signal)).data;
    if (result.app_id !== config.clientId || result.type !== type) throw new PublicationAccountError('identity-mismatch');
    if (!result.is_valid) throw new PublicationAccountError('grant-rejected');
    const required = type === 'USER' ? INSTAGRAM_OAUTH_SCOPES : INSTAGRAM_OAUTH_SCOPES.filter(s => s !== 'pages_show_list');
    if (!required.every(scope => result.scopes.includes(scope))) throw new PublicationAccountError('scope-missing');
    const limits = [result.expires_at, (result.data_access_expires_at ?? 0)].filter(value => value > 0).map(value => value * 1000);
    if (type === 'USER' && (!result.user_id || result.expires_at === 0)) throw new PublicationAccountError('grant-rejected');
    const expiresAt = limits.length ? Math.min(...limits) : null;
    if (expiresAt !== null && expiresAt <= now() + 60000) throw new PublicationAccountError('grant-rejected');
    return { userId: result.user_id, expiresAt };
  }
  return {
    config, identity,
    begin() {
      const state = randomBytes(32).toString('base64url'), url = new URL(`https://www.facebook.com/${INSTAGRAM_GRAPH_VERSION}/dialog/oauth`);
      url.search = new URLSearchParams({ client_id: config.clientId, config_id: config.configurationId, redirect_uri: config.redirectUri,
        response_type: 'code', override_default_response_type: 'true', state }).toString();
      return { state, authorizationUrl: url.href };
    },
    async exchange(callback: URL, state: string, signal: AbortSignal): Promise<InstagramGrant[]> {
      try {
        if (`${callback.origin}${callback.pathname}` !== config.redirectUri || callback.hash || callback.href.length > 16384 || callback.searchParams.getAll('state').length !== 1 || callback.searchParams.get('state') !== state) throw new PublicationAccountError('invalid-callback');
        const codes = callback.searchParams.getAll('code'), errors = callback.searchParams.getAll('error');
        if (errors.length) {
          if (errors.length !== 1 || codes.length) throw new PublicationAccountError('invalid-callback');
          throw new PublicationAccountError(errors[0] === 'access_denied' ? 'denied' : 'invalid-callback');
        }
        if (codes.length !== 1 || !codes[0] || codes[0].length > 8192) throw new PublicationAccountError('invalid-callback');
        const short = tokenSchema.parse(await get('oauth/access_token', { client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: config.redirectUri, code: codes[0] }, null, signal));
        // Pin app, user and permission identity before and after the long-lived exchange.
        const initial = await inspect(short.access_token, 'USER', signal);
        const long = tokenSchema.parse(await get('oauth/access_token', { client_id: config.clientId, client_secret: config.clientSecret, grant_type: 'fb_exchange_token', fb_exchange_token: short.access_token }, null, signal));
        const user = await inspect(long.access_token, 'USER', signal);
        if (user.userId !== initial.userId) throw new PublicationAccountError('identity-mismatch');
        const result: InstagramGrant[] = [], cursors = new Set<string>(); let after: string | undefined;
        for (let page = 0; page < 5; page++) {
          const batch = pagesSchema.parse(await get('me/accounts', { fields: 'id,name,access_token,instagram_business_account{id,username},tasks', limit: '20', appsecret_proof: proof(long.access_token), ...(after ? { after } : {}) }, long.access_token, signal));
          for (const item of batch.data) {
            if (!item.instagram_business_account || (item.tasks && !item.tasks.some(task => ['CREATE_CONTENT', 'MANAGE', 'PROFILE_PLUS_CREATE_CONTENT', 'PROFILE_PLUS_FULL_CONTROL'].includes(task)))) continue;
            if (result.some(g => g.pageId === item.id)) throw new PublicationAccountError('identity-mismatch');
            result.push(instagramGrantSchema.parse({ pageId: item.id, instagramId: item.instagram_business_account.id, username: item.instagram_business_account.username ?? '', pageName: item.name, accessToken: item.access_token, expiresAt: null, userId: user.userId }));
          }
          if (!batch.paging?.next) { if (!result.length) throw new PublicationAccountError('identity-mismatch'); return result; }
          // Never follow paging.next: it may include tokens or an unexpected host. Use the bounded cursor on our fixed endpoint.
          after = batch.paging.cursors?.after;
          if (!after || cursors.has(after)) throw new PublicationAccountError('temporarily-unavailable');
          cursors.add(after);
        }
        throw new PublicationAccountError('busy');
      } catch (error) { throw safe(error); }
    },
    async verifyGrant(raw: InstagramGrant, signal: AbortSignal): Promise<InstagramGrant> {
      try {
        const grant = instagramGrantSchema.parse(raw), validity = await inspect(grant.accessToken, 'PAGE', signal);
        const page = z.object({ id: instagramIdSchema, instagram_business_account: z.object({ id: instagramIdSchema }) }).parse(await get(grant.pageId, { fields: 'id,instagram_business_account', appsecret_proof: proof(grant.accessToken) }, grant.accessToken, signal));
        if (page.id !== grant.pageId || page.instagram_business_account.id !== grant.instagramId) throw new PublicationAccountError('identity-mismatch');
        return { ...grant, expiresAt: validity.expiresAt };
      } catch (error) { throw safe(error); }
    },
  };
}
