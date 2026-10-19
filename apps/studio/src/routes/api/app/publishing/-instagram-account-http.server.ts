import { randomBytes } from 'node:crypto';
import { PublicationAccountError } from '@/core/publishing/account-contract';
import { instagramAccountRequest } from '@/core/publishing/instagram-accounts-contract';
import { metaOAuthEnvironment, openInstagramAccountManagement, openInstagramAccounts } from '@/core/publishing/instagram-accounts.server';
import { metaOAuthConfig, type MetaOAuthConfig } from '@/core/publishing/meta-oauth.server';
import type { AccountAvailability } from '@/core/publishing/account-requests';
import { readRequestJsonWithLimit } from '@/lib/request-body-limit';
import { validateTrustedWorkspaceJsonMutation, validateTrustedWorkspaceMutation } from '@/lib/trusted-local-request';
import { accountCookiePolicy, accountErrorResponse as errorResponse, accountHeaders as headers, accountNonce as nonce } from './-account-policy.server';

const { cookieName, cookie, binding } = accountCookiePolicy('instagram');
type Dependencies = { config: () => MetaOAuthConfig; management: typeof openInstagramAccountManagement; oauth: typeof openInstagramAccounts };
export function createInstagramAccountHttp(deps: Dependencies = { config: metaOAuthEnvironment, management: openInstagramAccountManagement, oauth: openInstagramAccounts }) {
  function configuration(request: Request) {
    const config = metaOAuthConfig(deps.config());
    if (new URL(request.url).origin !== new URL(config.redirectUri).origin) throw new PublicationAccountError('configuration');
    return config;
  }
  function availability(request: Request): AccountAvailability {
    try { const config = metaOAuthConfig(deps.config()); return new URL(request.url).origin === new URL(config.redirectUri).origin ? 'ready' : 'origin-mismatch'; }
    catch { return 'configuration'; }
  }
  return {
    async read(request: Request) {
      const trust = validateTrustedWorkspaceMutation(request);
      if (!trust.ok) return Response.json({ error: trust.message }, { status: trust.status, headers });
      try {
        const query = new URL(request.url).searchParams;
        if (query.has('state')) {
          const state = query.get('state')!;
          if (query.getAll('state').length !== 1 || !nonce.test(state)) throw new PublicationAccountError('invalid-callback');
          const config = configuration(request), browserBinding = binding(request, cookieName(state)), service = deps.oauth({ config });
          try { return Response.json({ selection: service.selection(state, browserBinding) }, { headers }); } finally { service.close(); }
        }
        const service = deps.management();
        try { return Response.json({ accounts: service.list(), instagram: availability(request) }, { headers }); } finally { service.close(); }
      } catch (error) { return errorResponse(error); }
    },
    async change(request: Request) {
      const trust = validateTrustedWorkspaceJsonMutation(request);
      if (!trust.ok) return Response.json({ error: trust.message }, { status: trust.status, headers });
      try {
        const body = instagramAccountRequest.parse(await readRequestJsonWithLimit(request, 4096));
        if (body.action === 'disconnect') {
          const service = deps.management();
          try { return Response.json({ account: service.disconnect(body.accountId, body.revision) }, { headers }); } finally { service.close(); }
        }
        const config = configuration(request);
        const browserBinding = body.action === 'connect' ? randomBytes(32).toString('base64url') : binding(request, cookieName(body.state));
        const service = deps.oauth({ config });
        try {
          if (body.action === 'connect') {
            const result = service.begin(browserBinding, body.reconnect), state = new URL(result.authorizationUrl).searchParams.get('state')!;
            return Response.json(result, { headers: { ...headers, 'Set-Cookie': cookie(cookieName(state), browserBinding, new URL(config.redirectUri).protocol === 'https:', 600) } });
          }
          const result = body.action === 'cancel' ? (service.cancel(body.state, browserBinding), { canceled: true }) : { account: await service.select(body.state, browserBinding, body.pageId, request.signal) };
          return Response.json(result, { headers: { ...headers, 'Set-Cookie': cookie(cookieName(body.state), '', new URL(config.redirectUri).protocol === 'https:', 0) } });
        } finally { service.close(); }
      } catch (error) { return errorResponse(error); }
    },
    async callback(request: Request) {
      const url = new URL(request.url), state = url.searchParams.get('state') ?? '';
      const name = nonce.test(state) && url.searchParams.getAll('state').length === 1 ? cookieName(state) : null;
      let location = '/connections?instagram=invalid-callback', keep = false;
      try {
        const config = configuration(request);
        if (!name) throw new PublicationAccountError('invalid-callback');
        const browserBinding = binding(request, name), service = deps.oauth({ config });
        try {
          await service.complete(url, browserBinding, request.signal);
          location = `/connections?instagram=select&instagramState=${state}`; keep = true;
        } finally { service.close(); }
      } catch (error) { location = `/connections?instagram=${error instanceof PublicationAccountError ? error.code : 'temporarily-unavailable'}`; }
      // A selection nonce is browser-bound and cannot retrieve any token. Never reflect callback codes or provider error text.
      return new Response(null, { status: 303, headers: { ...headers, 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'", Location: location,
        ...(name && !keep ? { 'Set-Cookie': cookie(name, '', url.protocol === 'https:', 0) } : {}) } });
    },
  };
}
