import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createGoogleOAuth, googleOAuthConfig, YOUTUBE_OAUTH_SCOPES } from './google-oauth.server';
import { PublicationAccountError, type AccountTokens, type AccountIssue } from './account-contract';

const config = { clientId: 'fixture.apps.googleusercontent.com', clientSecret: 'fixture-secret', redirectUri: 'http://127.0.0.1:3808/api/app/publishing/youtube/callback' };
const now = 2000000;
const response = { access_token: 'fixture-access', refresh_token: 'fixture-refresh', token_type: 'Bearer', expires_in: 3600, scope: YOUTUBE_OAUTH_SCOPES.join(' ') };
const prior: AccountTokens = { accessToken: 'old-access', refreshToken: 'old-refresh', expiresAt: 1, refreshExpiresAt: null, scopes: YOUTUBE_OAUTH_SCOPES };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
const signal = () => AbortSignal.timeout(10000);
const fails = (code: AccountIssue) => (error: unknown) => error instanceof PublicationAccountError && error.code === code;
function callback(state: string) {
  const url = new URL(config.redirectUri); url.search = new URLSearchParams({ state, code: 'fixture-code', iss: 'https://accounts.google.com' }).toString(); return url;
}

test('authorization uses state, S256 PKCE, offline consent and fixed server endpoints', async () => {
  let calls = 0, verifier = '';
  const client = createGoogleOAuth(config, { now: () => now, fetch: async (url, init) => {
    calls++; assert.equal(String(url), 'https://oauth2.googleapis.com/token'); assert.equal(init?.redirect, 'manual'); assert.equal(init?.credentials, 'omit');
    const body = new URLSearchParams(String(init?.body));
    assert.equal(body.get('grant_type'), 'authorization_code'); assert.equal(body.get('client_secret'), config.clientSecret);
    assert.equal(body.get('code_verifier'), verifier); assert.equal(body.get('redirect_uri'), config.redirectUri);
    return json(response);
  } });
  const flow = await client.begin(); verifier = flow.verifier; const url = new URL(flow.authorizationUrl);
  assert.equal(calls, 0); assert.equal(url.origin, 'https://accounts.google.com');
  assert.equal(url.searchParams.get('code_challenge'), createHash('sha256').update(verifier).digest('base64url'));
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256'); assert.equal(url.searchParams.get('access_type'), 'offline');
  assert.equal(url.searchParams.get('prompt'), 'consent select_account');
  assert.equal(url.searchParams.has('client_secret'), false); assert.equal(url.searchParams.has('code_verifier'), false);
  const tokens = await client.exchange(callback(flow.state), flow.state, verifier, signal());
  assert.equal(tokens.expiresAt, now + 3600000); assert.equal(tokens.refreshToken, response.refresh_token); assert.equal(calls, 1);
});

test('state, issuer, duplicate parameters, callback origin and denied consent fail before token exchange', async () => {
  let calls = 0;
  const client = createGoogleOAuth(config, { fetch: async () => { calls++; return json(response); } });
  const flow = await client.begin();
  const wrongState = callback('wrong'), wrongIssuer = callback(flow.state), duplicate = callback(flow.state), wrongOrigin = callback(flow.state), denied = callback(flow.state);
  wrongIssuer.searchParams.set('iss', 'https://attacker.invalid'); duplicate.searchParams.append('code', 'duplicate'); wrongOrigin.hostname = 'localhost';
  denied.searchParams.delete('code'); denied.searchParams.set('error', 'access_denied');
  for (const url of [wrongState, wrongIssuer, duplicate, wrongOrigin]) await assert.rejects(client.exchange(url, flow.state, flow.verifier, signal()), fails('invalid-callback'));
  await assert.rejects(client.exchange(denied, flow.state, flow.verifier, signal()), fails('denied')); assert.equal(calls, 0);
});

test('partial scopes and missing refresh grants are never persisted as a usable offline account', async () => {
  for (const [data, issue] of [[{ ...response, scope: YOUTUBE_OAUTH_SCOPES[0] }, 'scope-missing'], [{ ...response, refresh_token: undefined }, 'offline-unavailable']] as const) {
    const client = createGoogleOAuth(config, { fetch: async () => json(data) }); const flow = await client.begin();
    await assert.rejects(client.exchange(callback(flow.state), flow.state, flow.verifier, signal()), fails(issue));
  }
});

test('refresh preserves omitted scopes/refresh token, accepts rotation and observes time-limited grants', async () => {
  let calls = 0;
  const client = createGoogleOAuth(config, { now: () => now, fetch: async (_url, init) => {
    calls++; const body = new URLSearchParams(String(init?.body));
    assert.equal(body.get('grant_type'), 'refresh_token'); assert.equal(body.get('refresh_token'), prior.refreshToken);
    return json({ ...response, scope: undefined, refresh_token: undefined });
  } });
  const next = await client.refresh(prior, signal()); assert.equal(next.refreshToken, prior.refreshToken); assert.deepEqual(next.scopes, prior.scopes);
  await assert.rejects(client.refresh({ ...prior, refreshExpiresAt: now }, signal()), fails('grant-rejected')); assert.equal(calls, 1);
  const rotation = createGoogleOAuth(config, { now: () => now, fetch: async () => json({ ...response, refresh_token_expires_in: 86400 }) });
  const rotated = await rotation.refresh(prior, signal()); assert.equal(rotated.refreshToken, response.refresh_token); assert.equal(rotated.refreshExpiresAt, now + 86400000);
});

test('configuration errors, revoked grants and transport failures stay distinct without leaking response text', async () => {
  for (const [error, status, issue] of [['invalid_client', 401, 'configuration'], ['invalid_grant', 400, 'grant-rejected'], ['temporarily_unavailable', 503, 'temporarily-unavailable']] as const) {
    const client = createGoogleOAuth(config, { fetch: async () => json({ error, error_description: 'PRIVATE-response-token' }, status) });
    await assert.rejects(client.refresh(prior, signal()), reason => fails(issue)(reason) && !String(reason).includes('PRIVATE'));
  }
  const redirect = createGoogleOAuth(config, { fetch: async () => new Response(null, { status: 302, headers: { location: 'https://attacker.invalid' } }) });
  await assert.rejects(redirect.refresh(prior, signal()), fails('temporarily-unavailable'));
});

test('oversized and stalled token bodies are canceled within bounds', async () => {
  const large = createGoogleOAuth(config, { fetch: async () => json({ ...response, extra: 'x'.repeat(65536) }) });
  await assert.rejects(large.refresh(prior, signal()), fails('temporarily-unavailable'));
  let canceled = false;
  const stalled = createGoogleOAuth(config, { fetch: async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{')); }, cancel() { canceled = true; } }), { headers: { 'content-type': 'application/json' } }) });
  await assert.rejects(stalled.refresh(prior, AbortSignal.timeout(20)), fails('temporarily-unavailable')); assert.equal(canceled, true);
});

test('operator configuration never accepts a remote HTTP callback, credentials in URLs or arbitrary callback routes', () => {
  for (const redirectUri of ['http://example.com/api/app/publishing/youtube/callback', 'https://user:secret@example.com/api/app/publishing/youtube/callback', `${config.redirectUri}?token=secret`, 'https://example.com/other']) assert.throws(() => googleOAuthConfig({ ...config, redirectUri }), fails('configuration'));
  assert.equal(googleOAuthConfig({ ...config, redirectUri: 'https://studio.example/api/app/publishing/youtube/callback' }).redirectUri.startsWith('https:'), true);
});
