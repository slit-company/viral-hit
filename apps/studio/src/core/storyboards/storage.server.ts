import { DatabaseSync } from 'node:sqlite';
import { lstatSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { getViralHitDataRoot } from '@/config/data-root';
import { fingerprint, type Json, type Plan } from '../harness/durable';
import { MAX_STORYBOARD_BYTES, type StoryboardState, type StoryboardPlan, type StoryboardShot } from './contract';

export class StoryboardConflict extends Error {}
export const digest = (value: unknown) => fingerprint(JSON.parse(JSON.stringify(value)) as Json);
export const shotDigest = (plan: StoryboardPlan, shot: StoryboardShot) => digest({
  shot, intent: plan.intent, references: plan.references.filter(ref => shot.references.includes(ref.id)),
});
export type StoryboardAction = {
  projectId: string; boardId: string; requestId: string; kind: 'generate' | 'assemble';
  revision: number; shotId?: string; shotDigest?: string; outputNodeId: string;
  requestDigest: string; plan: Plan; runId: string | null;
};
function open(readOnly = false) {
  const root = getViralHitDataRoot(), path = join(root, 'storyboards.sqlite');
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (stat && (!stat.isFile() || stat.isSymbolicLink())) throw Error('Storyboard storage is not a regular file');
  if (readOnly && !stat) return null;
  if (!readOnly) mkdirSync(root, { recursive: true });
  const db = new DatabaseSync(path, { readOnly });
  db.exec('PRAGMA busy_timeout=5000');
  if (!readOnly) db.exec(
    'CREATE TABLE IF NOT EXISTS revisions(project_id TEXT NOT NULL,board_id TEXT NOT NULL,revision INTEGER NOT NULL,document TEXT NOT NULL,PRIMARY KEY(project_id,board_id,revision));' +
    'CREATE TABLE IF NOT EXISTS actions(project_id TEXT NOT NULL,request_id TEXT NOT NULL,board_id TEXT NOT NULL,document TEXT NOT NULL,PRIMARY KEY(project_id,request_id));'
  );
  return db;
}
function read(db: DatabaseSync, projectId: string, id: string, revision?: number): StoryboardState | null {
  const row = revision === undefined
    ? db.prepare('SELECT document FROM revisions WHERE project_id=? AND board_id=? ORDER BY revision DESC LIMIT 1').get(projectId, id)
    : db.prepare('SELECT document FROM revisions WHERE project_id=? AND board_id=? AND revision=?').get(projectId, id, revision);
  return row ? JSON.parse(String(row.document)) : null;
}
export function readStoryboard(projectId: string, id: string, revision?: number) {
  const db = open(true); if (!db) return null;
  try { return read(db, projectId, id, revision); } finally { db.close(); }
}
export function listStoryboards(projectId: string) {
  const db = open(true); if (!db) return [];
  try { return db.prepare('SELECT board_id,MAX(revision) AS revision FROM revisions WHERE project_id=? GROUP BY board_id ORDER BY board_id').all(projectId).map(row => {
    const state = read(db, projectId, String(row.board_id))!;
    return { id: state.id, revision: state.revision, title: state.plan.title, scope: state.plan.scope, shots: state.plan.shots.length, accepted: Object.keys(state.accepted).length };
  }); } finally { db.close(); }
}
function encoded(value: unknown) {
  const json = JSON.stringify(value);
  if (Buffer.byteLength(json) > MAX_STORYBOARD_BYTES) throw Error('Storyboard document exceeds 256 KB');
  return json;
}
function write<T>(operation: (db: DatabaseSync) => T) {
  const db = open()!;
  try { db.exec('BEGIN IMMEDIATE'); const result = operation(db); db.exec('COMMIT'); return result; }
  catch (error) { db.exec('ROLLBACK'); throw error; } finally { db.close(); }
}
function expectRevision(db: DatabaseSync, projectId: string, id: string, expected: number) {
  const current = read(db, projectId, id);
  if ((current?.revision ?? 0) !== expected) throw new StoryboardConflict('Storyboard changed. Read the current plan and review again.');
  return current;
}
export function changeStoryboard(projectId: string, id: string, expected: number, change: (current: StoryboardState | null) => Pick<StoryboardState, 'plan' | 'accepted'>) {
  return write(db => {
    const current = expectRevision(db, projectId, id, expected);
    if (!current && Number(db.prepare('SELECT COUNT(DISTINCT board_id) AS n FROM revisions WHERE project_id=?').get(projectId)!.n) >= 64) throw Error('Storyboard identity limit reached');
    if (Number(db.prepare('SELECT COUNT(*) AS n FROM revisions WHERE project_id=?').get(projectId)!.n) >= 512) throw Error('Storyboard revision limit reached');
    const next: StoryboardState = { ...change(current), projectId, id, revision: expected + 1 };
    db.prepare('INSERT INTO revisions VALUES(?,?,?,?)').run(projectId, id, next.revision, encoded(next));
    return next;
  });
}
export function readAction(projectId: string, boardId: string, requestId: string) {
  const db = open(true); if (!db) return null;
  try {
    const row = db.prepare('SELECT document FROM actions WHERE project_id=? AND request_id=? AND board_id=?').get(projectId, requestId, boardId);
    return row ? JSON.parse(String(row.document)) as StoryboardAction : null;
  } finally { db.close(); }
}
export function listActions(projectId: string, boardId: string) {
  const db = open(true); if (!db) return [];
  try { return db.prepare('SELECT document FROM actions WHERE project_id=? AND board_id=? ORDER BY rowid').all(projectId, boardId).map(row => JSON.parse(String(row.document)) as StoryboardAction); }
  finally { db.close(); }
}
export function reserveAction(action: StoryboardAction) {
  return write(db => {
    const row = db.prepare('SELECT document FROM actions WHERE project_id=? AND request_id=?').get(action.projectId, action.requestId);
    if (row) {
      const old = JSON.parse(String(row.document)) as StoryboardAction;
      if (old.requestDigest !== action.requestDigest || old.boardId !== action.boardId) throw new StoryboardConflict('Request ID belongs to a different storyboard action');
      return old;
    }
    expectRevision(db, action.projectId, action.boardId, action.revision);
    if (Number(db.prepare('SELECT COUNT(*) AS n FROM actions WHERE project_id=?').get(action.projectId)!.n) >= 256) throw Error('Storyboard action limit reached');
    encoded({ ...action, runId: '00000000-0000-0000-0000-000000000000' });
    // Enqueue the same JSON representation that a later process will resume.
    // Some runtime pins carry optional undefined properties before serialization.
    const document = encoded(action);
    db.prepare('INSERT INTO actions VALUES(?,?,?,?)').run(action.projectId, action.requestId, action.boardId, document);
    return JSON.parse(document) as StoryboardAction;
  });
}
export function recordRun(action: StoryboardAction, runId: string) {
  return write(db => {
    const row = db.prepare('SELECT document FROM actions WHERE project_id=? AND request_id=?').get(action.projectId, action.requestId);
    if (!row) throw Error('Storyboard action missing');
    const current = JSON.parse(String(row.document)) as StoryboardAction;
    if (current.requestDigest !== action.requestDigest || (current.runId && current.runId !== runId)) throw Error('Storyboard run identity mismatch');
    const next = { ...current, runId };
    db.prepare('UPDATE actions SET document=? WHERE project_id=? AND request_id=?').run(encoded(next), action.projectId, action.requestId);
    return next;
  });
}
