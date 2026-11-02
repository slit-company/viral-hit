import { DatabaseSync } from 'node:sqlite';
import { lstatSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { getViralHitDataRoot } from '@/config/data-root';
import { MAX_ACTIVE_SHARES, MAX_PROJECT_COMMENTS, type CommentAnchor, type CommentAuthorKind, type CommentView, type ShareRole, type ShareView } from './contract';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS shares (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('viewer', 'editor')),
  token_hash TEXT NOT NULL UNIQUE, label TEXT, created_at INTEGER NOT NULL, last_used_at INTEGER, revoked_at INTEGER);
CREATE INDEX IF NOT EXISTS shares_project ON shares (project_id);
CREATE TABLE IF NOT EXISTS comments (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, share_id TEXT, author TEXT NOT NULL,
  author_kind TEXT NOT NULL CHECK (author_kind IN ('owner', 'agent', 'guest')), body TEXT NOT NULL, anchor TEXT NOT NULL,
  created_at INTEGER NOT NULL, resolved_at INTEGER, resolved_by TEXT);
CREATE INDEX IF NOT EXISTS comments_project ON comments (project_id, created_at);`;

type ShareRow = { id: string; project_id: string; role: ShareRole; label: string | null; created_at: number; last_used_at: number | null; revoked_at: number | null };
type CommentRow = { id: string; share_id: string | null; author: string; author_kind: CommentAuthorKind; body: string; anchor: string; created_at: number; resolved_at: number | null; resolved_by: string | null };
export type StoredShare = ShareView & { projectId: string };
export type StoredComment = CommentView & { shareId: string | null };

/** Shares and comments live in one small database beside the project data; each call opens and closes it. */
function withDatabase<T>(work: (db: DatabaseSync) => T): T {
  const path = join(getViralHitDataRoot(), 'collaboration.sqlite');
  if (lstatSync(path, { throwIfNoEntry: false })?.isSymbolicLink()) throw Error('Collaboration storage must be a regular file');
  mkdirSync(getViralHitDataRoot(), { recursive: true });
  const db = new DatabaseSync(path);
  try { db.exec('PRAGMA busy_timeout=5000'); db.exec(SCHEMA); return work(db); } finally { db.close(); }
}

const share = (row: ShareRow): StoredShare => ({ id: row.id, projectId: row.project_id, role: row.role, label: row.label, createdAt: row.created_at, lastUsedAt: row.last_used_at, revokedAt: row.revoked_at });
const comment = (row: CommentRow): StoredComment => ({
  id: row.id, shareId: row.share_id, body: row.body, author: row.author, authorKind: row.author_kind, anchor: JSON.parse(row.anchor) as CommentAnchor,
  createdAt: row.created_at, resolvedAt: row.resolved_at, resolvedBy: row.resolved_by,
});

export function insertShare(projectId: string, role: ShareRole, tokenHash: string, label: string | null): StoredShare {
  return withDatabase(db => {
    const active = db.prepare('SELECT COUNT(*) AS count FROM shares WHERE project_id=? AND revoked_at IS NULL').get(projectId) as { count: number };
    if (active.count >= MAX_ACTIVE_SHARES) throw Error('Revoke an old link first: a project keeps at most ' + MAX_ACTIVE_SHARES + ' active links');
    const row: ShareRow = { id: randomUUID(), project_id: projectId, role, label, created_at: Date.now(), last_used_at: null, revoked_at: null };
    db.prepare('INSERT INTO shares (id, project_id, role, token_hash, label, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(row.id, projectId, role, tokenHash, label, row.created_at);
    return share(row);
  });
}
export const listShares = (projectId: string) => withDatabase(db => (db.prepare('SELECT * FROM shares WHERE project_id=? ORDER BY created_at DESC LIMIT 100').all(projectId) as ShareRow[]).map(share));
export function revokeShare(projectId: string, shareId: string) {
  return withDatabase(db => db.prepare('UPDATE shares SET revoked_at=? WHERE id=? AND project_id=? AND revoked_at IS NULL').run(Date.now(), shareId, projectId).changes > 0);
}
/** An active link by its token hash; using it records when it was last opened. */
export function activeShareByHash(tokenHash: string): StoredShare | null {
  return withDatabase(db => {
    const row = db.prepare('SELECT * FROM shares WHERE token_hash=? AND revoked_at IS NULL').get(tokenHash) as ShareRow | undefined;
    if (!row) return null;
    const now = Date.now();
    if (!row.last_used_at || now - row.last_used_at > 60_000) db.prepare('UPDATE shares SET last_used_at=? WHERE id=?').run(now, row.id);
    return share({ ...row, last_used_at: now });
  });
}

export function insertComment(projectId: string, input: { shareId: string | null; author: string; authorKind: CommentAuthorKind; body: string; anchor: CommentAnchor }): StoredComment {
  return withDatabase(db => {
    const total = db.prepare('SELECT COUNT(*) AS count FROM comments WHERE project_id=?').get(projectId) as { count: number };
    if (total.count >= MAX_PROJECT_COMMENTS) throw Error('This project has reached ' + MAX_PROJECT_COMMENTS + ' comments; delete settled ones first');
    const row: CommentRow = { id: randomUUID(), share_id: input.shareId, author: input.author, author_kind: input.authorKind, body: input.body, anchor: JSON.stringify(input.anchor), created_at: Date.now(), resolved_at: null, resolved_by: null };
    db.prepare('INSERT INTO comments (id, project_id, share_id, author, author_kind, body, anchor, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(row.id, projectId, row.share_id, row.author, row.author_kind, row.body, row.anchor, row.created_at);
    return comment(row);
  });
}
export const listComments = (projectId: string) => withDatabase(db => (db.prepare('SELECT * FROM comments WHERE project_id=? ORDER BY created_at ASC LIMIT ?').all(projectId, MAX_PROJECT_COMMENTS) as CommentRow[]).map(comment));
export const findComment = (projectId: string, commentId: string) => withDatabase(db => {
  const row = db.prepare('SELECT * FROM comments WHERE id=? AND project_id=?').get(commentId, projectId) as CommentRow | undefined;
  return row ? comment(row) : null;
});
export function setCommentResolved(projectId: string, commentId: string, resolvedBy: string | null) {
  return withDatabase(db => db.prepare('UPDATE comments SET resolved_at=?, resolved_by=? WHERE id=? AND project_id=?').run(resolvedBy ? Date.now() : null, resolvedBy, commentId, projectId).changes > 0);
}
export const deleteComment = (projectId: string, commentId: string) => withDatabase(db => db.prepare('DELETE FROM comments WHERE id=? AND project_id=?').run(commentId, projectId).changes > 0);
