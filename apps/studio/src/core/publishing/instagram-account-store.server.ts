import { randomUUID, timingSafeEqual } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { accountFile, createPrivateAccountFile } from './account-files.server';
import { PublicationAccountError, type AccountIssue } from './account-contract';
import { instagramCandidate, instagramGrantSchema, type InstagramGrant, type InstagramAccount } from './instagram-accounts-contract';
import type { CredentialVault } from './credential-vault.server';

type AccountRow = { id: string; instagram_id: string; page_id: string; page_name: string; username: string; client_identity: string; credential: string | null; status: InstagramAccount['status']; revision: number; issue: AccountIssue | null; updated_at: number };
export type InstagramFlow = { stateHash: string; browserHash: string; clientIdentity: string; redirectUri: string; accountId: string; expectedRevision: number | null };
type FlowRow = { state_hash: string; browser_hash: string; client_identity: string; redirect_uri: string; account_id: string; expected_revision: number | null; phase: string; claim_token: string | null; expires_at: number; selected_page_id: string | null };
export type InstagramFlowClaim = InstagramFlow & { claimToken: string };
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const view = (row: AccountRow): InstagramAccount => ({ id: row.id, provider: 'instagram', instagramId: row.instagram_id, pageId: row.page_id, pageName: row.page_name, username: row.username, status: row.status, revision: row.revision, issue: row.issue, updatedAt: row.updated_at });

/** Separate provider lifecycle: temporary Page selection, no invented Google refresh token. */
export class InstagramAccountStore {
  private readonly db: DatabaseSync;
  constructor(private vault: CredentialVault, private now = Date.now) {
    const file = accountFile(vault.root, 'accounts.sqlite');
    for (const suffix of ['-wal', '-shm']) accountFile(vault.root, `accounts.sqlite${suffix}`);
    createPrivateAccountFile(file); this.db = new DatabaseSync(file);
    try {
      this.db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
        CREATE TABLE IF NOT EXISTS vault_identity(id INTEGER PRIMARY KEY CHECK(id=1),fingerprint TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS instagram_accounts(id TEXT PRIMARY KEY,instagram_id TEXT NOT NULL,page_id TEXT NOT NULL,page_name TEXT NOT NULL,username TEXT NOT NULL,client_identity TEXT NOT NULL,credential TEXT,status TEXT NOT NULL,revision INTEGER NOT NULL,issue TEXT,updated_at INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS instagram_flows(state_hash TEXT PRIMARY KEY,browser_hash TEXT NOT NULL,client_identity TEXT NOT NULL,redirect_uri TEXT NOT NULL,account_id TEXT NOT NULL,expected_revision INTEGER,phase TEXT NOT NULL,claim_token TEXT,expires_at INTEGER NOT NULL,selected_page_id TEXT);
        CREATE TABLE IF NOT EXISTS instagram_candidates(state_hash TEXT NOT NULL,page_id TEXT NOT NULL,credential TEXT NOT NULL,PRIMARY KEY(state_hash,page_id));`);
      this.transaction(() => {
        this.db.prepare('INSERT OR IGNORE INTO vault_identity(id,fingerprint) VALUES(1,?)').run(vault.fingerprint);
        if (this.db.prepare('SELECT fingerprint FROM vault_identity WHERE id=1').get()?.fingerprint !== vault.fingerprint) throw new PublicationAccountError('vault-unavailable');
      });
    } catch (error) { this.db.close(); throw error; }
  }
  close() { this.db.close(); }
  private transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const value = fn(); this.db.exec('COMMIT'); return value; }
    catch (error) { if (this.db.isTransaction) this.db.exec('ROLLBACK'); throw error; }
  }
  private row(id: string) { return this.db.prepare('SELECT * FROM instagram_accounts WHERE id=?').get(id) as AccountRow | undefined; }
  private flow(id: string) { return this.db.prepare('SELECT * FROM instagram_flows WHERE state_hash=?').get(id) as FlowRow | undefined; }
  private clear(stateHash: string) {
    this.db.prepare('DELETE FROM instagram_candidates WHERE state_hash=?').run(stateHash);
    this.db.prepare('DELETE FROM instagram_flows WHERE state_hash=?').run(stateHash);
  }
  private prune() {
    this.db.prepare('DELETE FROM instagram_candidates WHERE state_hash IN (SELECT state_hash FROM instagram_flows WHERE expires_at<=?)').run(this.now());
    this.db.prepare('DELETE FROM instagram_flows WHERE expires_at<=?').run(this.now());
  }
  private original(flow: InstagramFlow) {
    const account = this.row(flow.accountId);
    if (flow.expectedRevision === null ? !!account : !account || account.revision !== flow.expectedRevision || account.client_identity !== flow.clientIdentity) throw new PublicationAccountError('invalid-callback');
    return account;
  }
  private bound(stateHash: string, browserHash: string, clientIdentity: string) {
    hash.parse(stateHash); hash.parse(browserHash); hash.parse(clientIdentity);
    const flow = this.flow(stateHash);
    if (!flow || flow.expires_at <= this.now() || flow.client_identity !== clientIdentity || !timingSafeEqual(Buffer.from(flow.browser_hash), Buffer.from(browserHash))) throw new PublicationAccountError('invalid-callback');
    return flow;
  }
  get(id: string) { const row = this.row(id); return row ? view(row) : null; }
  list() { return this.transaction(() => { this.prune(); return (this.db.prepare('SELECT * FROM instagram_accounts ORDER BY updated_at DESC LIMIT 200').all() as AccountRow[]).map(view); }); }
  begin(flow: InstagramFlow) {
    hash.parse(flow.stateHash); hash.parse(flow.browserHash); hash.parse(flow.clientIdentity); z.uuid().parse(flow.accountId);
    z.string().url().max(2048).parse(flow.redirectUri);
    return this.transaction(() => {
      this.prune(); this.original(flow);
      if (Number(this.db.prepare('SELECT COUNT(*) AS count FROM instagram_flows').get()?.count) >= 64) throw new PublicationAccountError('busy');
      this.db.prepare("INSERT INTO instagram_flows VALUES(?,?,?,?,?,?,'pending',NULL,?,NULL)").run(flow.stateHash, flow.browserHash, flow.clientIdentity, flow.redirectUri, flow.accountId, flow.expectedRevision, this.now() + 600000);
    });
  }
  consume(stateHash: string, browserHash: string, clientIdentity: string, redirectUri: string): InstagramFlowClaim {
    return this.transaction(() => {
      const row = this.bound(stateHash, browserHash, clientIdentity);
      if (row.phase !== 'pending' || row.redirect_uri !== redirectUri) throw new PublicationAccountError('invalid-callback');
      const claim: InstagramFlowClaim = { stateHash, browserHash, clientIdentity, redirectUri, accountId: row.account_id, expectedRevision: row.expected_revision, claimToken: randomUUID() };
      this.original(claim);
      this.db.prepare("UPDATE instagram_flows SET phase='exchanging',claim_token=?,expires_at=? WHERE state_hash=?").run(claim.claimToken, this.now() + 60000, stateHash);
      return claim;
    });
  }
  fail(claim: InstagramFlowClaim) { this.transaction(() => { if (this.flow(claim.stateHash)?.claim_token === claim.claimToken) this.clear(claim.stateHash); }); }
  stage(claim: InstagramFlowClaim, raw: InstagramGrant[]) {
    const grants = z.array(instagramGrantSchema).min(1).max(100).parse(raw);
    if (new Set(grants.map(g => g.pageId)).size !== grants.length || grants.some(g => (g.expiresAt !== null && g.expiresAt <= this.now() + 60000))) throw new PublicationAccountError('temporarily-unavailable');
    return this.transaction(() => {
      const row = this.bound(claim.stateHash, claim.browserHash, claim.clientIdentity), original = this.original(claim);
      if (row.phase !== 'exchanging' || row.claim_token !== claim.claimToken) throw new PublicationAccountError('invalid-callback');
      const selected = original ? grants.filter(g => g.pageId === original.page_id && g.instagramId === original.instagram_id) : grants;
      if (!selected.length) throw new PublicationAccountError('identity-mismatch');
      for (const grant of selected) this.db.prepare('INSERT INTO instagram_candidates VALUES(?,?,?)').run(claim.stateHash, grant.pageId, this.vault.seal(`flow/${claim.stateHash}_${grant.pageId}`, grant));
      this.db.prepare("UPDATE instagram_flows SET phase='selecting',claim_token=NULL,expires_at=? WHERE state_hash=?").run(this.now() + 300000, claim.stateHash);
    });
  }
  selection(stateHash: string, browserHash: string, clientIdentity: string) {
    const flow = this.bound(stateHash, browserHash, clientIdentity);
    if (flow.phase !== 'selecting') throw new PublicationAccountError('busy');
    const rows = this.db.prepare('SELECT page_id,credential FROM instagram_candidates WHERE state_hash=? ORDER BY page_id').all(stateHash) as { page_id: string; credential: string }[];
    const candidates = rows.map(row => instagramCandidate(instagramGrantSchema.parse(this.vault.open(`flow/${stateHash}_${row.page_id}`, row.credential))));
    return { candidates, expiresAt: flow.expires_at };
  }
  claimSelection(stateHash: string, browserHash: string, clientIdentity: string, pageId: string) {
    return this.transaction(() => {
      const row = this.bound(stateHash, browserHash, clientIdentity);
      if (row.phase !== 'selecting') throw new PublicationAccountError('busy');
      const candidate = this.db.prepare('SELECT credential FROM instagram_candidates WHERE state_hash=? AND page_id=?').get(stateHash, pageId) as { credential: string } | undefined;
      if (!candidate) throw new PublicationAccountError('invalid-callback');
      const grant = instagramGrantSchema.parse(this.vault.open(`flow/${stateHash}_${pageId}`, candidate.credential));
      const claim: InstagramFlowClaim = { stateHash, browserHash, clientIdentity, redirectUri: row.redirect_uri, accountId: row.account_id, expectedRevision: row.expected_revision, claimToken: randomUUID() };
      this.original(claim);
      this.db.prepare("UPDATE instagram_flows SET phase='committing',claim_token=?,selected_page_id=? WHERE state_hash=?").run(claim.claimToken, pageId, stateHash);
      return { claim, grant };
    });
  }
  connect(claim: InstagramFlowClaim, raw: InstagramGrant) {
    const grant = instagramGrantSchema.parse(raw);
    return this.transaction(() => {
      const row = this.bound(claim.stateHash, claim.browserHash, claim.clientIdentity), prior = this.original(claim);
      if (row.phase !== 'committing' || row.claim_token !== claim.claimToken || row.selected_page_id !== grant.pageId) throw new PublicationAccountError('invalid-callback');
      if (grant.expiresAt !== null && grant.expiresAt <= this.now() + 60000) throw new PublicationAccountError('grant-rejected');
      if (prior && (prior.page_id !== grant.pageId || prior.instagram_id !== grant.instagramId)) throw new PublicationAccountError('identity-mismatch');
      const candidate = this.db.prepare('SELECT credential FROM instagram_candidates WHERE state_hash=? AND page_id=?').get(claim.stateHash, grant.pageId) as { credential: string } | undefined;
      if (!candidate) throw new PublicationAccountError('invalid-callback');
      const approved = instagramGrantSchema.parse(this.vault.open(`flow/${claim.stateHash}_${grant.pageId}`, candidate.credential));
      if (approved.accessToken !== grant.accessToken || approved.instagramId !== grant.instagramId || approved.userId !== grant.userId) throw new PublicationAccountError('identity-mismatch');
      const revision = (prior?.revision ?? 0) + 1;
      this.db.prepare(`INSERT INTO instagram_accounts VALUES(?,?,?,?,?, ?,?,'connected',?,NULL,?) ON CONFLICT(id) DO UPDATE SET page_name=excluded.page_name,username=excluded.username,credential=excluded.credential,status='connected',revision=excluded.revision,issue=NULL,updated_at=excluded.updated_at`).run(claim.accountId, grant.instagramId, grant.pageId, grant.pageName, grant.username, claim.clientIdentity, this.vault.seal(`account/${claim.accountId}`, grant), revision, this.now());
      this.clear(claim.stateHash); return this.get(claim.accountId)!;
    });
  }
  cancel(stateHash: string, browserHash: string, clientIdentity: string) { this.transaction(() => { this.bound(stateHash, browserHash, clientIdentity); this.clear(stateHash); }); }
  disconnect(id: string, revision: number) {
    return this.transaction(() => {
      const row = this.row(id);
      if (!row || row.revision !== revision) throw new PublicationAccountError('invalid-callback');
      this.db.prepare("UPDATE instagram_accounts SET status='disconnected',credential=NULL,revision=revision+1,issue=NULL,updated_at=? WHERE id=?").run(this.now(), id);
      const flows = this.db.prepare('SELECT state_hash FROM instagram_flows WHERE account_id=?').all(id) as { state_hash: string }[];
      for (const flow of flows) this.clear(flow.state_hash);
      return this.get(id)!;
    });
  }
  credential(id: string, clientIdentity: string) {
    const row = this.row(id);
    if (!row || row.status !== 'connected' || !row.credential) throw new PublicationAccountError('disconnected');
    if (row.client_identity !== clientIdentity) throw new PublicationAccountError('configuration');
    const grant = instagramGrantSchema.parse(this.vault.open(`account/${id}`, row.credential));
    if (grant.expiresAt !== null && grant.expiresAt <= this.now() + 60000) { this.invalidate(id, clientIdentity, grant.accessToken, row.revision); throw new PublicationAccountError('grant-rejected'); }
    return { ...grant, revision: row.revision };
  }
  invalidate(id: string, clientIdentity: string, token: string, revision?: number) {
    this.transaction(() => {
      const row = this.row(id);
      if (!row || row.status !== 'connected' || row.client_identity !== clientIdentity || !row.credential) return;
      const grant = instagramGrantSchema.parse(this.vault.open(`account/${id}`, row.credential));
      if (grant.accessToken !== token || (revision !== undefined && row.revision !== revision)) return;
      this.db.prepare("UPDATE instagram_accounts SET status='reconnect-required',issue='grant-rejected',updated_at=? WHERE id=?").run(this.now(), id);
    });
  }
}
