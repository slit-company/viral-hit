import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { MEMORY_SCOPE_LIMIT, type ApprovalMode, type ApprovalState, type ApprovalStep, type ApprovalView, type MemoryEntry } from './contract';

/** Agent settings, approvals and memory live in the durable harness database next to the runs they gate. */
export function ensureAgentTables(db: DatabaseSync) {
  db.exec(`CREATE TABLE IF NOT EXISTS vh_agent_settings(name TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS vh_approvals(id TEXT PRIMARY KEY, project_id TEXT NOT NULL, kind TEXT NOT NULL, run_id TEXT, fingerprint TEXT,
      channel TEXT NOT NULL, tool TEXT NOT NULL, steps_json TEXT NOT NULL, state TEXT NOT NULL, created_at INTEGER NOT NULL, decided_at INTEGER);
    CREATE INDEX IF NOT EXISTS vh_approvals_state ON vh_approvals(state, created_at);
    CREATE INDEX IF NOT EXISTS vh_approvals_fingerprint ON vh_approvals(fingerprint, created_at);
    CREATE TABLE IF NOT EXISTS vh_agent_memory(id TEXT PRIMARY KEY, project_id TEXT, text TEXT NOT NULL, source TEXT NOT NULL,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS vh_agent_memory_scope ON vh_agent_memory(project_id, updated_at);`);
}

export function readApprovalMode(db: DatabaseSync): ApprovalMode {
  ensureAgentTables(db);
  const row = db.prepare("SELECT value FROM vh_agent_settings WHERE name='approval_mode'").get() as { value: string } | undefined;
  return row?.value === 'ask' ? 'ask' : 'off';
}

export function writeApprovalMode(db: DatabaseSync, mode: ApprovalMode) {
  ensureAgentTables(db);
  db.prepare(`INSERT INTO vh_agent_settings(name,value,updated_at) VALUES('approval_mode',?,?)
    ON CONFLICT(name) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`).run(mode, Date.now());
}

type ApprovalRow = {
  id: string; project_id: string; kind: 'run' | 'request'; run_id: string | null; fingerprint: string | null;
  channel: 'mcp' | 'cli'; tool: string; steps_json: string; state: ApprovalState; created_at: number; decided_at: number | null;
};
const approval = (row: ApprovalRow): ApprovalView => ({
  id: row.id, projectId: row.project_id, projectName: null, kind: row.kind, runId: row.run_id, channel: row.channel, tool: row.tool,
  steps: JSON.parse(row.steps_json) as ApprovalStep[], state: row.state,
  createdAt: new Date(row.created_at).toISOString(), decidedAt: row.decided_at ? new Date(row.decided_at).toISOString() : null,
});

export function insertApproval(db: DatabaseSync, input: {
  projectId: string; kind: 'run' | 'request'; runId?: string; fingerprint?: string; channel: 'mcp' | 'cli'; tool: string; steps: ApprovalStep[];
}) {
  ensureAgentTables(db);
  const row: ApprovalRow = {
    id: randomUUID(), project_id: input.projectId, kind: input.kind, run_id: input.runId ?? null, fingerprint: input.fingerprint ?? null,
    channel: input.channel, tool: input.tool, steps_json: JSON.stringify(input.steps), state: 'pending', created_at: Date.now(), decided_at: null,
  };
  db.prepare('INSERT INTO vh_approvals(id,project_id,kind,run_id,fingerprint,channel,tool,steps_json,state,created_at,decided_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run(row.id, row.project_id, row.kind, row.run_id, row.fingerprint, row.channel, row.tool, row.steps_json, row.state, row.created_at, row.decided_at);
  return approval(row);
}

export function readApproval(db: DatabaseSync, id: string) {
  ensureAgentTables(db);
  const row = db.prepare('SELECT * FROM vh_approvals WHERE id=?').get(id) as ApprovalRow | undefined;
  return row ? approval(row) : null;
}

export function latestApprovalFor(db: DatabaseSync, fingerprint: string) {
  ensureAgentTables(db);
  const row = db.prepare('SELECT * FROM vh_approvals WHERE fingerprint=? ORDER BY created_at DESC, rowid DESC LIMIT 1').get(fingerprint) as ApprovalRow | undefined;
  return row ? approval(row) : null;
}

export function listApprovals(db: DatabaseSync, { states, limit }: { states: readonly ApprovalState[]; limit: number }) {
  ensureAgentTables(db);
  const rows = db.prepare(`SELECT * FROM vh_approvals WHERE state IN (${states.map(() => '?').join(',')})
    ORDER BY COALESCE(decided_at, created_at) DESC LIMIT ?`).all(...states, limit) as unknown as ApprovalRow[];
  return rows.map(approval);
}

export function countPendingApprovals(db: DatabaseSync) {
  ensureAgentTables(db);
  return (db.prepare("SELECT COUNT(*) AS count FROM vh_approvals WHERE state='pending'").get() as { count: number }).count;
}

/** Moves a pending approval to approved or rejected; anything already decided stays as it is. */
export function settleApproval(db: DatabaseSync, id: string, state: 'approved' | 'rejected') {
  ensureAgentTables(db);
  db.prepare("UPDATE vh_approvals SET state=?, decided_at=? WHERE id=? AND state='pending'").run(state, Date.now(), id);
  return readApproval(db, id);
}

/** Spends an approved request once: true only for the call that moves it to used. */
export function consumeApproval(db: DatabaseSync, id: string) {
  ensureAgentTables(db);
  return Number(db.prepare("UPDATE vh_approvals SET state='used' WHERE id=? AND state='approved'").run(id).changes) === 1;
}

type MemoryRow = { id: string; project_id: string | null; text: string; source: 'person' | 'agent'; created_at: number; updated_at: number };
const memory = (row: MemoryRow): MemoryEntry => ({
  id: row.id, projectId: row.project_id, projectName: null, text: row.text, source: row.source,
  createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString(),
});

/** Workspace memory plus one project's memory, or every entry when projectId is undefined. */
export function listMemory(db: DatabaseSync, projectId?: string | null) {
  ensureAgentTables(db);
  const rows = (projectId === undefined
    ? db.prepare('SELECT * FROM vh_agent_memory ORDER BY updated_at DESC').all()
    : db.prepare('SELECT * FROM vh_agent_memory WHERE project_id IS NULL OR project_id=? ORDER BY updated_at DESC').all(projectId)) as unknown as MemoryRow[];
  return rows.map(memory);
}

export function saveMemory(db: DatabaseSync, input: { id?: string; projectId: string | null; text: string; source: 'person' | 'agent' }) {
  ensureAgentTables(db);
  const now = Date.now();
  if (input.id) {
    const changed = db.prepare('UPDATE vh_agent_memory SET text=?, source=?, updated_at=? WHERE id=?').run(input.text, input.source, now, input.id).changes;
    if (!Number(changed)) throw new Error('Memory entry not found.');
  } else {
    const count = db.prepare('SELECT COUNT(*) AS count FROM vh_agent_memory WHERE project_id IS ?').get(input.projectId) as { count: number };
    if (count.count >= MEMORY_SCOPE_LIMIT) throw new Error(`Memory holds up to ${MEMORY_SCOPE_LIMIT} entries per scope. Forget an old entry first.`);
    input = { ...input, id: randomUUID() };
    db.prepare('INSERT INTO vh_agent_memory(id,project_id,text,source,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(input.id!, input.projectId, input.text, input.source, now, now);
  }
  return memory(db.prepare('SELECT * FROM vh_agent_memory WHERE id=?').get(input.id!) as MemoryRow);
}

export function forgetMemory(db: DatabaseSync, id: string) {
  ensureAgentTables(db);
  return Number(db.prepare('DELETE FROM vh_agent_memory WHERE id=?').run(id).changes) === 1;
}
