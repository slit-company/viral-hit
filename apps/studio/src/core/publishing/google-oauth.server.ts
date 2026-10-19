import { createHash } from 'node:crypto';
import * as oauth from 'oauth4webapi';
import { z } from 'zod';
import { accountTokensSchema, PublicationAccountError, type AccountTokens } from './account-contract';

export const YOUTUBE_OAUTH_SCOPES = ['https://www.googleapis.com/auth/youtube.upload', 'https://www.googleapis.com/auth/youtube.readonly'];
const authorizationServer: oauth.AuthorizationServer = {
  issuer: 'https://accounts.google.com', authorization_endpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  token_endpoint: 'https://oauth2.googleapis.com/token', authorization_response_iss_parameter_supported: true,
};
export type GoogleOAuthConfig = { clientId: string; clientSecret: string; redirectUri: string };
export function googleOAuthConfig(raw: GoogleOAuthConfig) {
  if (!/^[a-zA-Z0-9_.-]{1,256}\.apps\.googleusercontent\.com$/.test(raw.clientId) || !raw.clientSecret || raw.clientSecret.length > 8192 || /\s/.test(raw.clientSecret)) throw new PublicationAccountError('configuration');
  let redirect: URL;
  try { redirect = new URL(raw.redirectUri); } catch { throw new PublicationAccountError('configuration'); }
  const loopback = ['127.0.0.1', '[::1]', 'localhost'].includes(redirect.hostname);
  if ((redirect.protocol !== 'https:' && !(redirect.protocol === 'http:' && loopback)) || redirect.username || redirect.password || redirect.search || redirect.hash || redirect.pathname !== '/api/app/publishing/youtube/callback') throw new PublicationAccountError('configuration');
  return { ...raw, redirectUri: redirect.href };
}
/** Secret rotation does not change the client identity; callback URI is separately pinned per flow. */
export const googleClientIdentity = (config: GoogleOAuthConfig) => createHash('sha256').update(`${authorizationServer.issuer}\n${config.clientId}`).digest('hex');

function safeError(error: unknown): PublicationAccountError {
  if (error instanceof PublicationAccountError) return error;
  if (error instanceof oauth.AuthorizationResponseError) return new PublicationAccountError(error.error === 'access_denied' ? 'denied' : 'invalid-callback');
  if (error instanceof oauth.ResponseBodyError && error.error === 'invalid_grant') return new PublicationAccountError('grant-rejected');
  if (error instanceof oauth.ResponseBodyError && ['invalid_client', 'unauthorized_client'].includes(error.error)) return new PublicationAccountError('configuration');
  return new PublicationAccountError('temporarily-unavailable');
}
async function boundedResponse(response: Response, signal: AbortSignal) {
  const reader = response.body?.getReader();
  if (!reader) throw new PublicationAccountError('temporarily-unavailable');
  const chunks: Uint8Array[] = []; let length = 0;
  const abort = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    for (;;) {
      signal.throwIfAborted(); const { done, value } = await reader.read(); if (done) break;
      length += value.length;
      if (length > 64 * 1024) throw new PublicationAccountError('temporarily-unavailable');
      chunks.push(value);
    }
    signal.throwIfAborted();
    return new Response(Buffer.concat(chunks, length), { status: response.status, headers: response.headers });
  } finally { signal.removeEventListener('abort', abort); await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}
function tokens(result: oauth.TokenEndpointResponse, now: number, prior?: AccountTokens): AccountTokens {
  if (result.token_type !== 'bearer') throw new PublicationAccountError('grant-rejected');
  const scopes = result.scope === undefined ? prior?.scopes ?? [] : result.scope.split(' ').filter(Boolean);
  if (!YOUTUBE_OAUTH_SCOPES.every(scope => scopes.includes(scope))) throw new PublicationAccountError('scope-missing');
  const refreshToken = result.refresh_token ?? prior?.refreshToken;
  if (!refreshToken) throw new PublicationAccountError('offline-unavailable');
  const expiresIn = z.number().int().positive().max(86400).parse(result.expires_in);
  const refreshExpiresIn = result.refresh_token_expires_in === undefined ? null : z.number().int().positive().max(10 * 365 * 86400).parse(result.refresh_token_expires_in);
  return accountTokensSchema.parse({ accessToken: result.access_token, refreshToken, scopes, expiresAt: now + expiresIn * 1000,
    refreshExpiresAt: refreshExpiresIn === null ? prior?.refreshExpiresAt ?? null : now + refreshExpiresIn * 1000 });
}

export function createGoogleOAuth(raw: GoogleOAuthConfig, options: { fetch?: typeof fetch; now?: () => number } = {}) {
  const config = googleOAuthConfig(raw), client: oauth.Client = { client_id: config.clientId };
  const clientAuth = oauth.ClientSecretPost(config.clientSecret), now = options.now ?? Date.now;
  function requestOptions(parent: AbortSignal): oauth.TokenEndpointRequestOptions {
    const signal = AbortSignal.any([parent, AbortSignal.timeout(15000)]);
    return { signal, [oauth.customFetch]: async (url, init) => {
      signal.throwIfAborted();
      if (url !== authorizationServer.token_endpoint) throw new PublicationAccountError('configuration');
      const response = await (options.fetch ?? fetch)(url, { ...init, signal, redirect: 'manual', credentials: 'omit' });
      if (response.status >= 300 && response.status < 400) { await response.body?.cancel(); throw new PublicationAccountError('temporarily-unavailable'); }
      return boundedResponse(response, signal);
    } };
  }
  return {
    config, identity: googleClientIdentity(config),
    async begin() {
      const state = oauth.generateRandomState(), verifier = oauth.generateRandomCodeVerifier();
      const url = new URL(authorizationServer.authorization_endpoint!);
      url.search = new URLSearchParams({ client_id: config.clientId, redirect_uri: config.redirectUri, response_type: 'code',
        scope: YOUTUBE_OAUTH_SCOPES.join(' '), access_type: 'offline', prompt: 'consent select_account',
        state, code_challenge: await oauth.calculatePKCECodeChallenge(verifier), code_challenge_method: 'S256' }).toString();
      return { state, verifier, authorizationUrl: url.href };
    },
    async exchange(callback: URL, state: string, verifier: string, signal: AbortSignal) {
      try {
        if (`${callback.origin}${callback.pathname}` !== config.redirectUri || callback.hash || callback.href.length > 16384) throw new PublicationAccountError('invalid-callback');
        const codes = callback.searchParams.getAll('code'), errors = callback.searchParams.getAll('error');
        if (errors.length ? errors.length !== 1 || codes.length !== 0 : codes.length !== 1 || !codes[0] || codes[0].length > 8192) throw new PublicationAccountError('invalid-callback');
        let parameters: URLSearchParams;
        try { parameters = oauth.validateAuthResponse(authorizationServer, client, callback, state); }
        catch (error) { if (error instanceof oauth.AuthorizationResponseError) throw safeError(error); throw new PublicationAccountError('invalid-callback'); }
        const startedAt = now();
        const response = await oauth.authorizationCodeGrantRequest(authorizationServer, client, clientAuth, parameters, config.redirectUri, verifier, requestOptions(signal));
        return tokens(await oauth.processAuthorizationCodeResponse(authorizationServer, client, response), startedAt);
      } catch (error) { throw safeError(error); }
    },
    async refresh(prior: AccountTokens, signal: AbortSignal) {
      try {
        const validated = accountTokensSchema.parse(prior);
        if (validated.refreshExpiresAt !== null && validated.refreshExpiresAt <= now()) throw new PublicationAccountError('grant-rejected');
        const startedAt = now();
        const response = await oauth.refreshTokenGrantRequest(authorizationServer, client, clientAuth, validated.refreshToken, requestOptions(signal));
        return tokens(await oauth.processRefreshTokenResponse(authorizationServer, client, response), startedAt, validated);
      } catch (error) { throw safeError(error); }
    },
  };
}
