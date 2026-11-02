import type { DurableHarness } from '../harness/durable';

/** How a shot run belongs to a Cinema sequence: one row per run, several runs (attempts) per shot. */
export type ShotRecord = {
  requestId: string; sequenceId: string; shotId: string; position: number;
  spec: unknown; continuesFrom: string | null; createdAt: number;
};

const ensure = (h: DurableHarness) => h.db.exec(`CREATE TABLE IF NOT EXISTS vh_cinema_shots(
  request_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, sequence_id TEXT NOT NULL, shot_id TEXT NOT NULL,
  position INTEGER NOT NULL, spec_json TEXT NOT NULL, continues_from TEXT, created_at INTEGER NOT NULL);
  CREATE INDEX IF NOT EXISTS vh_cinema_shots_sequence ON vh_cinema_shots(project_id, sequence_id, position);`);

type Row = { request_id: string; sequence_id: string; shot_id: string; position: number; spec_json: string; continues_from: string | null; created_at: number };
const view = (row: Row): ShotRecord => ({
  requestId: row.request_id, sequenceId: row.sequence_id, shotId: row.shot_id, position: row.position,
  spec: JSON.parse(row.spec_json), continuesFrom: row.continues_from, createdAt: row.created_at,
});

/**
 * Places a new run: a known shot keeps its position (another attempt), a new shot goes after the
 * sequence's last one. Replaying the same request returns the stored placement.
 */
export function placeShot(h: DurableHarness, projectId: string, input: { requestId: string; sequenceId: string; shotId: string; spec: unknown; continuesFrom: string | null }) {
  ensure(h);
  const existing = h.db.prepare('SELECT * FROM vh_cinema_shots WHERE request_id=? AND project_id=?').get(input.requestId, projectId) as Row | undefined;
  if (existing) return view(existing);
  const known = h.db.prepare('SELECT position FROM vh_cinema_shots WHERE project_id=? AND sequence_id=? AND shot_id=? LIMIT 1').get(projectId, input.sequenceId, input.shotId) as { position: number } | undefined;
  const last = h.db.prepare('SELECT MAX(position) AS position FROM vh_cinema_shots WHERE project_id=? AND sequence_id=?').get(projectId, input.sequenceId) as { position: number | null };
  const row: Row = {
    request_id: input.requestId, sequence_id: input.sequenceId, shot_id: input.shotId,
    position: known?.position ?? (last.position ?? 0) + 1, spec_json: JSON.stringify(input.spec),
    continues_from: input.continuesFrom, created_at: Date.now(),
  };
  h.db.prepare('INSERT INTO vh_cinema_shots VALUES(?,?,?,?,?,?,?,?)')
    .run(row.request_id, projectId, row.sequence_id, row.shot_id, row.position, row.spec_json, row.continues_from, row.created_at);
  return view(row);
}

export function readShotRecords(h: DurableHarness, projectId: string) {
  ensure(h);
  const rows = h.db.prepare('SELECT * FROM vh_cinema_shots WHERE project_id=?').all(projectId) as unknown as Row[];
  return new Map(rows.map((row) => [row.request_id, view(row)]));
}
