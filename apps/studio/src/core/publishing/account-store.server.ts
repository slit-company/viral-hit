import { randomUUID, timingSafeEqual } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { accountTokensSchema, PublicationAccountError, type AccountTokens, type AccountIssue, type PublicationAccount } from './account-contract';
import { accountFile, createPrivateAccountFile } from './account-files.server';
import type { CredentialVault } from './credential-vault.server';

type Row = { id: string; channel_id: string; channel_title: string; client_identity: string; credential: string | null; status: PublicationAccount['status']; revision: number; issue: AccountIssue | null; updated_at: number; lease_token: string | null; lease_until: number; next_refresh: number };
type FlowRow = { state_hash: string; browser_hash: string; account_id: string; client_identity: string; redirect_uri: string; verifier: string; expected_revision: number | null; expires_at: number; claim_token: string | null };
export type AccountFlow = { stateHash: string; browserHash: string; accountId: string; clientIdentity: string; redirectUri: string; verifier: string; expectedRevision: number | null };
export type ClaimedAccountFlow = AccountFlow & { claimToken: string };
export type RefreshClaim = { accountId: string; revision: number; clientIdentity: string; leaseToken: string; channelId: string; tokens: AccountTokens };
function view(row: Row): PublicationAccount {
  return { id: row.id, provider: 'youtube', channelId: row.channel_id, channelTitle: row.channel_title, status: row.status, revision: row.revision, issue: row.issue, updatedAt: row.updated_at };
}
const hash = z.string().regex(/^[a-f0-9]{64}$/), id = z.uuid();

/** Account lifecycle and leases only. Provider requests never run inside a transaction. */
export class PublicationAccountStore {
  private readonly db: DatabaseSync;
  constructor(private vault: CredentialVault, private now = Date.now) {
    const file = accountFile(vault.root, 'accounts.sqlite');
    for (const suffix of ['-wal', '-shm']) accountFile(vault.root, `accounts.sqlite${suffix}`);
    createPrivateAccountFile(file);
    this.db = new DatabaseSync(file);
    try {
      this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
        CREATE TABLE IF NOT EXISTS vault_identity (id INTEGER PRIMARY KEY CHECK(id=1), fingerprint TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS publishing_accounts (
          id TEXT PRIMARY KEY, channel_id TEXT NOT NULL, channel_title TEXT NOT NULL, client_identity TEXT NOT NULL,
          credential TEXT, status TEXT NOT NULL, revision INTEGER NOT NULL, issue TEXT, updated_at INTEGER NOT NULL,
          lease_token TEXT, lease_until INTEGER NOT NULL DEFAULT 0, next_refresh INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE IF NOT EXISTS account_flows (
          state_hash TEXT PRIMARY KEY, browser_hash TEXT NOT NULL, account_id TEXT NOT NULL, client_identity TEXT NOT NULL,
          redirect_uri TEXT NOT NULL, verifier TEXT NOT NULL, expected_revision INTEGER, expires_at INTEGER NOT NULL, claim_token TEXT);`);
      this.transaction(() => {
        this.db.prepare('INSERT OR IGNORE INTO vault_identity(id,fingerprint) VALUES(1,?)').run(vault.fingerprint);
        const row = this.db.prepare('SELECT fingerprint FROM vault_identity WHERE id=1').get() as { fingerprint: string };
        if (row.fingerprint !== vault.fingerprint) throw new PublicationAccountError('vault-unavailable');
      });
    } catch (error) { this.db.close(); throw error; }
  }
  close() { this.db.close(); }
  private transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (error) { if (this.db.isTransaction) this.db.exec('ROLLBACK'); throw error; }
  }
  private row(accountId: string) { return this.db.prepare('SELECT * FROM publishing_accounts WHERE id=?').get(accountId) as Row | undefined; }
  get(accountId: string) { const row = this.row(accountId); return row ? view(row) : null; }
  list() { return (this.db.prepare('SELECT * FROM publishing_accounts ORDER BY updated_at DESC LIMIT 200').all() as Row[]).map(view); }
  begin(flow: AccountFlow) {
    hash.parse(flow.stateHash); hash.parse(flow.browserHash); hash.parse(flow.clientIdentity); id.parse(flow.accountId);
    z.string().min(43).max(128).regex(/^[a-zA-Z0-9_~-]+$/).parse(flow.verifier);
    z.string().url().max(2048).parse(flow.redirectUri);
    return this.transaction(() => {
      this.db.prepare('DELETE FROM account_flows WHERE expires_at<=?').run(this.now());
      const count = this.db.prepare('SELECT COUNT(*) AS count FROM account_flows').get() as { count: number };
      if (count.count >= 64) throw new PublicationAccountError('busy');
      const existing = this.row(flow.accountId);
      if (flow.expectedRevision === null ? !!existing : !existing || existing.revision !== flow.expectedRevision || existing.client_identity !== flow.clientIdentity) throw new PublicationAccountError('invalid-callback');
      this.db.prepare('INSERT INTO account_flows(state_hash,browser_hash,account_id,client_identity,redirect_uri,verifier,expected_revision,expires_at) VALUES(?,?,?,?,?,?,?,?)').run(
        flow.stateHash, flow.browserHash, flow.accountId, flow.clientIdentity, flow.redirectUri, this.vault.seal(`flow/${flow.stateHash}`, { verifier: flow.verifier }), flow.expectedRevision, this.now() + 600000);
    });
  }
  consume(stateHash: string, browserHash: string, clientIdentity: string, redirectUri: string): ClaimedAccountFlow {
    hash.parse(stateHash); hash.parse(browserHash);
    return this.transaction(() => {
      const row = this.db.prepare('SELECT * FROM account_flows WHERE state_hash=?').get(stateHash) as FlowRow | undefined;
      if (!row || row.claim_token || row.expires_at <= this.now() || row.client_identity !== clientIdentity || row.redirect_uri !== redirectUri || !timingSafeEqual(Buffer.from(row.browser_hash), Buffer.from(browserHash))) throw new PublicationAccountError('invalid-callback');
      const verifier = z.object({ verifier: z.string().min(43).max(128) }).parse(this.vault.open(`flow/${stateHash}`, row.verifier)).verifier;
      const claimToken = randomUUID();
      this.db.prepare('UPDATE account_flows SET claim_token=?,expires_at=? WHERE state_hash=?').run(claimToken, this.now() + 60000, stateHash);
      return { stateHash, browserHash, clientIdentity, redirectUri, accountId: row.account_id, expectedRevision: row.expected_revision, verifier, claimToken };
    });
  }
  failFlow(flow: ClaimedAccountFlow) { this.db.prepare('DELETE FROM account_flows WHERE state_hash=? AND claim_token=?').run(flow.stateHash, flow.claimToken); }
  connect(flow: ClaimedAccountFlow, channel: { id: string; title: string }, raw: AccountTokens) {
    const tokens = accountTokensSchema.parse(raw);
    z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/).parse(channel.id); z.string().max(1000).parse(channel.title);
    const sealed = this.vault.seal(`account/${flow.accountId}`, tokens);
    return this.transaction(() => {
      const pending = this.db.prepare('SELECT * FROM account_flows WHERE state_hash=? AND claim_token=? AND expires_at>?').get(flow.stateHash, flow.claimToken, this.now()) as FlowRow | undefined;
      if (!pending || pending.account_id !== flow.accountId || pending.client_identity !== flow.clientIdentity || pending.expected_revision !== flow.expectedRevision) throw new PublicationAccountError('invalid-callback');
      const prior = this.row(flow.accountId);
      if (flow.expectedRevision === null ? !!prior : !prior || prior.revision !== flow.expectedRevision || prior.client_identity !== flow.clientIdentity) throw new PublicationAccountError('invalid-callback');
      if (prior && prior.channel_id !== channel.id) throw new PublicationAccountError('identity-mismatch');
      this.db.prepare(`INSERT INTO publishing_accounts(id,channel_id,channel_title,client_identity,credential,status,revision,updated_at) VALUES(?,?,?,?,?,'connected',?,?)
        ON CONFLICT(id) DO UPDATE SET channel_title=excluded.channel_title,credential=excluded.credential,status='connected',revision=excluded.revision,issue=NULL,updated_at=excluded.updated_at,lease_token=NULL,lease_until=0,next_refresh=0`).run(
        flow.accountId, channel.id, channel.title, flow.clientIdentity, sealed, (prior?.revision ?? 0) + 1, this.now());
      this.failFlow(flow); return this.get(flow.accountId)!;
    });
  }
  disconnect(accountId: string, revision: number) {
    return this.transaction(() => {
      const prior = this.row(accountId);
      if (!prior || prior.revision !== revision) throw new PublicationAccountError('invalid-callback');
      this.db.prepare("UPDATE publishing_accounts SET credential=NULL,status='disconnected',revision=revision+1,issue=NULL,updated_at=?,lease_token=NULL,lease_until=0 WHERE id=?").run(this.now(), accountId);
      this.db.prepare('DELETE FROM account_flows WHERE account_id=?').run(accountId);
      return this.get(accountId)!;
    });
  }
  /** Cache lookup and refresh claiming are atomic across server/worker processes. */
  tokenOrLease(accountId: string, clientIdentity: string): { kind: 'cached'; accessToken: string } | { kind: 'refresh'; claim: RefreshClaim } {
    return this.transaction(() => {
      const row = this.row(accountId);
      if (!row || row.status !== 'connected' || !row.credential) throw new PublicationAccountError('disconnected');
      if (row.client_identity !== clientIdentity) throw new PublicationAccountError('configuration');
      const tokens = accountTokensSchema.parse(this.vault.open(`account/${accountId}`, row.credential));
      if (tokens.expiresAt > this.now() + 60000 && (tokens.refreshExpiresAt === null || tokens.refreshExpiresAt > this.now())) return { kind: 'cached', accessToken: tokens.accessToken };
      if (row.lease_until > this.now() || row.next_refresh > this.now()) throw new PublicationAccountError('busy');
      const leaseToken = randomUUID();
      this.db.prepare('UPDATE publishing_accounts SET lease_token=?,lease_until=? WHERE id=?').run(leaseToken, this.now() + 90000, accountId);
      return { kind: 'refresh', claim: { accountId, revision: row.revision, clientIdentity, leaseToken, channelId: row.channel_id, tokens } };
    });
  }
  refreshed(claim: RefreshClaim, raw: AccountTokens) {
    const credential = this.vault.seal(`account/${claim.accountId}`, accountTokensSchema.parse(raw));
    return this.db.prepare(`UPDATE publishing_accounts SET credential=?,issue=NULL,updated_at=?,lease_token=NULL,lease_until=0,next_refresh=0
      WHERE id=? AND revision=? AND client_identity=? AND status='connected' AND lease_token=? AND lease_until>?`).run(credential, this.now(), claim.accountId, claim.revision, claim.clientIdentity, claim.leaseToken, this.now()).changes === 1;
  }
  invalidateToken(accountId: string, clientIdentity: string, rejectedToken: string) {
    this.transaction(() => {
      const row = this.row(accountId);
      if (!row || row.status !== 'connected' || row.client_identity !== clientIdentity || !row.credential) return;
      const tokens = accountTokensSchema.parse(this.vault.open(`account/${accountId}`, row.credential));
      // A late 401 for an old request must not expire a newer refreshed/reconnected credential.
      if (tokens.accessToken !== rejectedToken) return;
      const credential = this.vault.seal(`account/${accountId}`, { ...tokens, expiresAt: 1 });
      this.db.prepare('UPDATE publishing_accounts SET credential=? WHERE id=?').run(credential, accountId);
    });
  }
  refreshFailed(claim: RefreshClaim, issue: AccountIssue, terminal: boolean) {
    return this.db.prepare(`UPDATE publishing_accounts SET status=?,issue=?,updated_at=?,lease_token=NULL,lease_until=0,next_refresh=?
      WHERE id=? AND revision=? AND client_identity=? AND status='connected' AND lease_token=? AND lease_until>?`).run(terminal ? 'reconnect-required' : 'connected', issue, this.now(), this.now() + 30000, claim.accountId, claim.revision, claim.clientIdentity, claim.leaseToken, this.now()).changes === 1;
  }
}
