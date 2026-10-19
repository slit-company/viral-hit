import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PublicationAccountStore, type AccountFlow } from './account-store.server';
import { openCredentialVault } from './credential-vault.server';
import { YOUTUBE_OAUTH_SCOPES } from './google-oauth.server';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'vh-account-store-')), vault = openCredentialVault(root);
  let now = 1000000; const store = new PublicationAccountStore(vault, () => now);
  const tokens = { accessToken: 'old-token', refreshToken: 'refresh-secret', expiresAt: now + 3600000, refreshExpiresAt: null, scopes: YOUTUBE_OAUTH_SCOPES };
  const flow = (): AccountFlow => ({ stateHash: randomBytes(32).toString('hex'), browserHash: 'b'.repeat(64), clientIdentity: 'c'.repeat(64), accountId: randomUUID(), redirectUri: 'https://studio.example/callback', verifier: randomBytes(32).toString('base64url'), expectedRevision: null });
  const first = flow(); store.begin(first); const claim = store.consume(first.stateHash, first.browserHash, first.clientIdentity, first.redirectUri);
  return { store, tokens, first, claim, flow, tick: (milliseconds: number) => { now += milliseconds; }, connect: () => store.connect(claim, { id: 'channel', title: 'Fixture' }, tokens), cleanup: () => { store.close(); vault.close(); rmSync(root, { recursive: true, force: true }); } };
}

test('late unauthorized responses cannot invalidate a newer refreshed credential', () => {
  const f = fixture();
  try {
    const account = f.connect(); f.store.invalidateToken(account.id, f.first.clientIdentity, 'old-token');
    const lease = f.store.tokenOrLease(account.id, f.first.clientIdentity); assert.equal(lease.kind, 'refresh');
    if (lease.kind !== 'refresh') throw new Error('Expected refresh lease');
    assert.equal(f.store.refreshed(lease.claim, { ...f.tokens, accessToken: 'new-token' }), true);
    f.store.invalidateToken(account.id, f.first.clientIdentity, 'old-token');
    assert.deepEqual(f.store.tokenOrLease(account.id, f.first.clientIdentity), { kind: 'cached', accessToken: 'new-token' });
  } finally { f.cleanup(); }
});

test('expired refresh writers cannot replace credentials owned by a subsequent lease', () => {
  const f = fixture();
  try {
    const account = f.connect(); f.store.invalidateToken(account.id, f.first.clientIdentity, 'old-token');
    const old = f.store.tokenOrLease(account.id, f.first.clientIdentity); assert.equal(old.kind, 'refresh');
    f.tick(90001); const current = f.store.tokenOrLease(account.id, f.first.clientIdentity); assert.equal(current.kind, 'refresh');
    if (old.kind !== 'refresh' || current.kind !== 'refresh') throw new Error('Expected refresh leases');
    assert.equal(f.store.refreshed(old.claim, { ...f.tokens, accessToken: 'stale' }), false);
    assert.equal(f.store.refreshFailed(old.claim, 'grant-rejected', true), false);
    assert.equal(f.store.refreshed(current.claim, { ...f.tokens, accessToken: 'current' }), true);
    assert.deepEqual(f.store.tokenOrLease(account.id, f.first.clientIdentity), { kind: 'cached', accessToken: 'current' });
  } finally { f.cleanup(); }
});

test('claimed callback identity cannot be reassigned and pending attempts are capped and expire', () => {
  const f = fixture();
  try {
    assert.throws(() => f.store.connect({ ...f.claim, accountId: randomUUID() }, { id: 'channel', title: 'Fixture' }, f.tokens), /invalid-callback/);
    f.connect();
    for (let index = 0; index < 64; index++) f.store.begin(f.flow());
    assert.throws(() => f.store.begin(f.flow()), /busy/);
    f.tick(600001); assert.doesNotThrow(() => f.store.begin(f.flow()));
  } finally { f.cleanup(); }
});
