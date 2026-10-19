import { createHash, randomBytes } from 'node:crypto';
import { ZodError } from 'zod';
import { PublicationAccountError } from '@/core/publishing/account-contract';
import { accountRequest, type AccountAvailability } from '@/core/publishing/account-requests';
import { openPublishingAccountManagement } from '@/core/publishing/account-management.server';
import { googleOAuthConfig, type GoogleOAuthConfig } from '@/core/publishing/google-oauth.server';
import { googleOAuthEnvironment, openYouTubeAccounts } from '@/core/publishing/youtube-accounts.server';
import { readRequestJsonWithLimit, RequestBodyTooLargeError } from '@/lib/request-body-limit';
import { validateTrustedWorkspaceJsonMutation, validateTrustedWorkspaceMutation } from '@/lib/trusted-local-request';

const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' };
const nonce = /^[a-zA-Z0-9_-]{43,128}$/;
const cookiePath = '/api/app/publishing/youtube/callback';
const cookieName = (state: string) => `vh-publishing-${createHash('sha256').update(state).digest('hex').slice(0, 24)}`;
function cookie(name: string, value: string, secure: boolean, age: number) {
  return `${name}=${value}; Path=${cookiePath}; HttpOnly; SameSite=Lax; Max-Age=${age}${secure ? '; Secure' : ''}`;
}
function binding(request: Request, name: string) {
  const values = (request.headers.get('cookie') ?? '').split(';').map(part => part.trim()).filter(part => part.startsWith(`${name}=`));
  const value = values.length === 1 ? values[0].slice(name.length + 1) : '';
  if (!nonce.test(value)) throw new PublicationAccountError('invalid-callback');
  return value;
}
function errorResponse(error: unknown) {
  const issue = error instanceof PublicationAccountError ? error.code : error instanceof ZodError ? 'invalid-request' : error instanceof RequestBodyTooLargeError ? 'request-too-large' : 'temporarily-unavailable';
  const status = issue === 'request-too-large' ? 413 : ['configuration', 'busy', 'vault-unavailable', 'temporarily-unavailable'].includes(issue) ? 503 : issue === 'invalid-callback' ? 409 : 400;
  return Response.json({ error: `Publishing account: ${issue}`, issue }, { status, headers });
}
type Dependencies = {
  config: () => GoogleOAuthConfig;
  management: typeof openPublishingAccountManagement;
  oauth: typeof openYouTubeAccounts;
};

/** Transport-owned cookie/trust policy; account persistence and provider calls stay in application services. */
export function createAccountHttp(deps: Dependencies = { config: googleOAuthEnvironment, management: openPublishingAccountManagement, oauth: openYouTubeAccounts }) {
  function configuration(request: Request) {
    const config = googleOAuthConfig(deps.config());
    if (new URL(request.url).origin !== new URL(config.redirectUri).origin) throw new PublicationAccountError('configuration');
    return config;
  }
  function availability(request: Request): AccountAvailability {
    try { const config = googleOAuthConfig(deps.config()); return new URL(request.url).origin === new URL(config.redirectUri).origin ? 'ready' : 'origin-mismatch'; }
    catch { return 'configuration'; }
  }
  return {
    async read(request: Request) {
      const trust = validateTrustedWorkspaceMutation(request);
      if (!trust.ok) return Response.json({ error: trust.message }, { status: trust.status, headers });
      try {
        const service = deps.management();
        try { return Response.json({ accounts: service.list(), youtube: availability(request) }, { headers }); }
        finally { service.close(); }
      } catch (error) { return errorResponse(error); }
    },
    async change(request: Request) {
      const trust = validateTrustedWorkspaceJsonMutation(request);
      if (!trust.ok) return Response.json({ error: trust.message }, { status: trust.status, headers });
      try {
        const body = accountRequest.parse(await readRequestJsonWithLimit(request, 4096));
        if (body.action === 'disconnect') {
          const service = deps.management();
          try { return Response.json({ account: service.disconnect(body.accountId, body.revision) }, { headers }); }
          finally { service.close(); }
        }
        const config = configuration(request), service = deps.oauth({ config });
        try {
          const browserBinding = randomBytes(32).toString('base64url');
          const result = await service.begin(browserBinding, body.reconnect);
          const state = new URL(result.authorizationUrl).searchParams.get('state')!;
          return Response.json(result, { headers: { ...headers, 'Set-Cookie': cookie(cookieName(state), browserBinding, new URL(config.redirectUri).protocol === 'https:', 600) } });
        } finally { service.close(); }
      } catch (error) { return errorResponse(error); }
    },
    async callback(request: Request) {
      const url = new URL(request.url), state = url.searchParams.get('state') ?? '';
      const name = nonce.test(state) && url.searchParams.getAll('state').length === 1 ? cookieName(state) : null;
      let result = 'invalid-callback';
      try {
        const config = configuration(request);
        if (!name) throw new PublicationAccountError('invalid-callback');
        const browserBinding = binding(request, name), service = deps.oauth({ config });
        try { await service.complete(url, browserBinding, request.signal); result = 'connected'; }
        finally { service.close(); }
      } catch (error) { result = error instanceof PublicationAccountError ? error.code : 'temporarily-unavailable'; }
      // No reflected code/state/error text, external redirect, HTML, or subresource on the callback.
      return new Response(null, { status: 303, headers: { ...headers, 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
        Location: `/connections?youtube=${result}`, ...(name ? { 'Set-Cookie': cookie(name, '', url.protocol === 'https:', 0) } : {}) } });
    },
  };
}
