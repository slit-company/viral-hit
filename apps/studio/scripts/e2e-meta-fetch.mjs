// Plain ESM so Nitro's child workers can preload this without a TypeScript loader.
// Production has no mock-provider setting; only start-e2e.mjs loads this module.
if (!process.env.VIRAL_HIT_DATA_DIR?.includes('viral-hit-e2e-') || process.env.VIRAL_HIT_META_APP_ID !== '123') throw new Error('Meta fixture requires the isolated E2E workspace');
const native = globalThis.fetch;
const scopes = ['instagram_basic', 'instagram_content_publish', 'pages_read_engagement', 'pages_show_list'];
globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.hostname !== 'graph.facebook.com') return native(input, init);
  if (init?.method !== 'GET' || init.redirect !== 'error') throw new Error('No Meta writes are allowed by this fixture');
  if (url.pathname === '/v26.0/oauth/access_token') return Response.json({ access_token: url.searchParams.has('code') ? 'fixture-meta-short' : 'fixture-meta-long', token_type: 'bearer', expires_in: 5184000 });
  if (url.pathname === '/v26.0/debug_token') {
    const page = url.searchParams.get('input_token')?.startsWith('fixture-meta-page-');
    return Response.json({ data: { app_id: '123', type: page ? 'PAGE' : 'USER', user_id: '999', is_valid: true, expires_at: page ? 0 : Math.floor(Date.now() / 1000) + 5184000, data_access_expires_at: 0, scopes } });
  }
  if (url.pathname === '/v26.0/me/accounts') return Response.json({ data: [
    { id: '111', name: 'Open Studio · experiments, stories and creative projects', access_token: 'fixture-meta-page-111', instagram_business_account: { id: '222', username: 'open_studio' }, tasks: ['CREATE_CONTENT'] },
    { id: '112', name: 'Field Notes · journeys and everyday observations', access_token: 'fixture-meta-page-112', instagram_business_account: { id: '223', username: 'field_notes' }, tasks: ['MANAGE'] },
  ] });
  if (url.pathname === '/v26.0/111' || url.pathname === '/v26.0/112') return Response.json({ id: url.pathname.endsWith('111') ? '111' : '112', instagram_business_account: { id: url.pathname.endsWith('111') ? '222' : '223' } });
  throw new Error('Unexpected Meta fixture request');
};
