import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, unlinkSync, existsSync, statSync, writeFileSync, truncateSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openCredentialVault } from './credential-vault.server';
import { PublicationAccountStore } from './account-store.server';

test('encryption is context-bound, tamper-evident and stable after restart with private key permissions', () => {
  const root = mkdtempSync(join(tmpdir(), 'vh-vault-'));
  const first = openCredentialVault(root);
  try {
    const value = { refreshToken: 'fixture-private-refresh' }, sealed = first.seal('account/one', value);
    assert.equal(sealed.includes(value.refreshToken), false); assert.deepEqual(first.open('account/one', sealed), value);
    assert.throws(() => first.open('account/two', sealed), /vault-unavailable/);
    assert.throws(() => first.open('flow/one', sealed), /vault-unavailable/);
    const bytes = Buffer.from(sealed, 'base64url'); bytes[bytes.length - 1] ^= 1;
    assert.throws(() => first.open('account/one', bytes.toString('base64url')), /vault-unavailable/);
    const second = openCredentialVault(root);
    try { assert.deepEqual(second.open('account/one', sealed), value); assert.equal(first.fingerprint, second.fingerprint); } finally { second.close(); }
    assert.equal(statSync(join(root, 'workspace.key')).mode & 0o777, 0o600);
    assert.equal(readFileSync(join(root, 'workspace.key')).length, 32);
  } finally { first.close(); rmSync(root, { recursive: true, force: true }); }
});

test('missing, replaced, oversized and symlink keys fail closed without silently creating a new identity', () => {
  const root = mkdtempSync(join(tmpdir(), 'vh-vault-')), vault = openCredentialVault(root);
  const store = new PublicationAccountStore(vault); store.close(); vault.close();
  try {
    const wrong = openCredentialVault(root, 'f'.repeat(64));
    try { assert.throws(() => new PublicationAccountStore(wrong), /vault-unavailable/); } finally { wrong.close(); }
    unlinkSync(join(root, 'workspace.key'));
    assert.throws(() => openCredentialVault(root), /vault-unavailable/); assert.equal(existsSync(join(root, 'workspace.key')), false);
    writeFileSync(join(root, 'workspace.key'), 'bad'); truncateSync(join(root, 'workspace.key'), 1024 ** 3);
    assert.throws(() => openCredentialVault(root), /vault-unavailable/);
    unlinkSync(join(root, 'workspace.key')); symlinkSync(join(root, 'accounts.sqlite'), join(root, 'workspace.key'));
    assert.throws(() => openCredentialVault(root), /vault-unavailable/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
