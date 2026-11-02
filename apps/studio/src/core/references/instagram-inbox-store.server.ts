import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { getViralHitDataRoot } from '../../config/data-root';
import type { InboxCheck, InboxItem, InboxOutcome, InboxSettings, InboxVideo } from './instagram-inbox-contract';

export type { InboxOutcome } from './instagram-inbox-contract';

export const INBOX_INTERVAL_MS = 15 * 60_000;
type CheckRow = { checked_at: number | null; outcome: InboxOutcome | null; imported: number; failed: number; requested_at: number | null; next_check_at: number | null; last_success_at: number | null };

/** Per-account collection settings, a ledger of collected messages and the last check. No message text or media URL is kept. */
export class InstagramInboxStore {
  private db: DatabaseSync;
  constructor(file = resolve(getViralHitDataRoot(), 'references', 'instagram-inbox.sqlite'), private now = Date.now) {
    if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(file);
    this.db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS inbox_settings(account_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, enabled INTEGER NOT NULL, revision INTEGER NOT NULL, updated_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS inbox_checks(account_id TEXT PRIMARY KEY, checked_at INTEGER, outcome TEXT, imported INTEGER NOT NULL DEFAULT 0, failed INTEGER NOT NULL DEFAULT 0, requested_at INTEGER, next_check_at INTEGER, last_success_at INTEGER);
      CREATE TABLE IF NOT EXISTS inbox_items(account_id TEXT NOT NULL, message_id TEXT NOT NULL, item_index INTEGER NOT NULL, kind TEXT NOT NULL, sender_username TEXT, sent_at INTEGER, status TEXT NOT NULL, asset_id TEXT, attempts INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY(account_id, message_id, item_index));`);
  }
  close() { this.db.close(); }
  settings(accountId: string): InboxSettings | null {
    const row = this.db.prepare('SELECT project_id, enabled, revision, updated_at FROM inbox_settings WHERE account_id=?').get(accountId) as { project_id: string; enabled: number; revision: number; updated_at: number } | undefined;
    return row ? { projectId: row.project_id, enabled: row.enabled === 1, revision: row.revision, updatedAt: row.updated_at } : null;
  }
  /** expectedRevision 0 creates; any other value must match, so two editors cannot overwrite each other. */
  configure(accountId: string, input: { projectId: string; enabled: boolean }, expectedRevision: number) {
    const current = this.settings(accountId);
    if ((current?.revision ?? 0) !== expectedRevision) throw new Error('Inbox settings changed; refresh and try again');
    this.db.prepare('INSERT INTO inbox_settings(account_id, project_id, enabled, revision, updated_at) VALUES(?,?,?,?,?) ON CONFLICT(account_id) DO UPDATE SET project_id=excluded.project_id, enabled=excluded.enabled, revision=excluded.revision, updated_at=excluded.updated_at')
      .run(accountId, input.projectId, input.enabled ? 1 : 0, expectedRevision + 1, this.now());
    // Turning collection on checks soon instead of waiting a full interval.
    if (input.enabled && !current?.enabled) this.schedule(accountId, this.now());
    return this.settings(accountId)!;
  }
  private schedule(accountId: string, at: number, requested = false) {
    this.db.prepare('INSERT INTO inbox_checks(account_id, next_check_at, requested_at) VALUES(?,?,?) ON CONFLICT(account_id) DO UPDATE SET next_check_at=excluded.next_check_at, requested_at=COALESCE(excluded.requested_at, inbox_checks.requested_at)')
      .run(accountId, at, requested ? this.now() : null);
  }
  requestCheck(accountId: string) { this.schedule(accountId, this.now(), true); return this.check(accountId); }
  check(accountId: string): InboxCheck {
    const row = this.db.prepare('SELECT * FROM inbox_checks WHERE account_id=?').get(accountId) as CheckRow | undefined;
    return { checkedAt: row?.checked_at ?? null, outcome: row?.outcome ?? null, imported: row?.imported ?? 0, failed: row?.failed ?? 0, requestedAt: row?.requested_at ?? null, nextCheckAt: row?.next_check_at ?? null };
  }
  /** Accounts with a requested check, or enabled collection whose next check is due. */
  due() {
    return (this.db.prepare(`SELECT s.account_id FROM inbox_settings s LEFT JOIN inbox_checks c ON c.account_id=s.account_id
      WHERE c.requested_at IS NOT NULL OR (s.enabled=1 AND COALESCE(c.next_check_at, 0) <= ?) ORDER BY COALESCE(c.next_check_at, 0)`).all(this.now()) as { account_id: string }[]).map(row => row.account_id);
  }
  lastSuccess(accountId: string) {
    return (this.db.prepare('SELECT last_success_at FROM inbox_checks WHERE account_id=?').get(accountId) as { last_success_at: number | null } | undefined)?.last_success_at ?? null;
  }
  finishCheck(accountId: string, outcome: InboxOutcome, imported = 0, failed = 0) {
    const now = this.now();
    this.db.prepare(`INSERT INTO inbox_checks(account_id, checked_at, outcome, imported, failed, requested_at, next_check_at, last_success_at) VALUES(?,?,?,?,?,NULL,?,?)
      ON CONFLICT(account_id) DO UPDATE SET checked_at=excluded.checked_at, outcome=excluded.outcome, imported=excluded.imported, failed=excluded.failed, requested_at=NULL, next_check_at=excluded.next_check_at, last_success_at=COALESCE(excluded.last_success_at, inbox_checks.last_success_at)`)
      .run(accountId, now, outcome, imported, failed, now + INBOX_INTERVAL_MS, outcome === 'ok' ? now : null);
  }
  item(accountId: string, messageId: string, index: number) {
    return (this.db.prepare('SELECT status, attempts FROM inbox_items WHERE account_id=? AND message_id=? AND item_index=?').get(accountId, messageId, index) as { status: InboxItem['status']; attempts: number } | undefined) ?? null;
  }
  recordItem(accountId: string, video: InboxVideo, status: InboxItem['status'], assetId: string | null) {
    this.db.prepare(`INSERT INTO inbox_items(account_id, message_id, item_index, kind, sender_username, sent_at, status, asset_id, attempts, updated_at) VALUES(?,?,?,?,?,?,?,?,1,?)
      ON CONFLICT(account_id, message_id, item_index) DO UPDATE SET status=excluded.status, asset_id=excluded.asset_id, attempts=inbox_items.attempts+1, updated_at=excluded.updated_at`)
      .run(accountId, video.messageId, video.index, video.kind, video.senderUsername, video.sentAt, status, assetId, this.now());
  }
  recent(accountId: string, limit = 5): InboxItem[] {
    const rows = this.db.prepare("SELECT * FROM inbox_items WHERE account_id=? AND status='imported' ORDER BY updated_at DESC LIMIT ?").all(accountId, limit) as { message_id: string; item_index: number; kind: InboxItem['kind']; sender_username: string | null; sent_at: number | null; status: InboxItem['status']; asset_id: string | null; attempts: number; updated_at: number }[];
    return rows.map(row => ({ messageId: row.message_id, index: row.item_index, kind: row.kind, senderUsername: row.sender_username, sentAt: row.sent_at, status: row.status, assetId: row.asset_id, attempts: row.attempts, updatedAt: row.updated_at }));
  }
}
