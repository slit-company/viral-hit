import { INSTAGRAM_OAUTH_SCOPES } from '../../src/core/publishing/meta-oauth.server';

/** Provider fixture only; no account consent or publishing occurs. */
export function createMetaFixture(now = Date.now) {
  let instagramId = '222', scopes = [...INSTAGRAM_OAUTH_SCOPES], appId = '123', revoked = false;
  let rejectPage = false;
  let beforePage: (() => Promise<void>) | undefined;
  const calls: { path: string; query: URLSearchParams; authorization: string | null }[] = [];
  const request: typeof fetch = async (input, init) => {
    const url = new URL(String(input)), authorization = new Headers(init?.headers).get('authorization');
    calls.push({ path: url.pathname, query: url.searchParams, authorization });
    if (url.hostname !== 'graph.facebook.com' || init?.method !== 'GET' || init.redirect !== 'error') throw new Error('Unexpected provider call');
    if (url.pathname === '/v26.0/oauth/access_token') return Response.json({ access_token: url.searchParams.has('code') ? 'fixture-meta-short' : 'fixture-meta-long', token_type: 'bearer', expires_in: 5184000 });
    if (url.pathname === '/v26.0/debug_token') {
      const token = url.searchParams.get('input_token')!;
      return Response.json({ data: { app_id: appId, type: token.startsWith('fixture-meta-page-') ? 'PAGE' : 'USER', user_id: '999', is_valid: !revoked, expires_at: token.startsWith('fixture-meta-page-') ? 0 : Math.floor(now() / 1000) + 5184000, data_access_expires_at: 0, scopes } });
    }
    if (url.pathname === '/v26.0/me/accounts') return Response.json({ data: [
      { id: '111', name: 'Open Studio · experiments, stories and creative projects', access_token: 'fixture-meta-page-111', instagram_business_account: { id: '222', username: 'open_studio' }, tasks: ['CREATE_CONTENT'] },
      { id: '112', name: 'Field Notes · journeys and everyday observations', access_token: 'fixture-meta-page-112', instagram_business_account: { id: '223', username: 'field_notes' }, tasks: ['MANAGE'] },
    ] });
    if (url.pathname === '/v26.0/111' || url.pathname === '/v26.0/112') {
      if (beforePage) await beforePage();
      if (rejectPage) return Response.json({ error: { code: 190, message: 'fixture revoked token' } }, { status: 400 });
      return Response.json({ id: url.pathname.endsWith('111') ? '111' : '112', instagram_business_account: { id: url.pathname.endsWith('111') ? instagramId : '223' } });
    }
    throw new Error('No upload or publication request is allowed by this fixture');
  };
  return { request, calls, changeDestination: (value: string) => { instagramId = value; }, removeScope: () => { scopes = scopes.filter(s => s !== 'instagram_content_publish'); }, wrongApp: () => { appId = '456'; }, revoke: () => { revoked = true; }, rejectPage: () => { rejectPage = true; }, beforePage: (fn: () => Promise<void>) => { beforePage = fn; } };
}
