import type { DatabaseSync } from 'node:sqlite';
import type { CanvasGenerationSnapshot } from './canvas-types';

/** One canvas take per harness job: which card it belongs to, the settings it ran with, and what the canvas shows. */
export type CanvasTake = {
  jobId: string; projectId: string; runId: string; cardId: string; outputCardId: string;
  snapshot: CanvasGenerationSnapshot; shownState: string | null;
};
type Row = { job_id: string; project_id: string; run_id: string; card_id: string; output_card_id: string; snapshot_json: string; shown_state: string | null };

const ensure = (db: DatabaseSync) => db.exec(`CREATE TABLE IF NOT EXISTS vh_canvas_takes(job_id TEXT PRIMARY KEY, project_id TEXT NOT NULL,
  run_id TEXT NOT NULL, card_id TEXT NOT NULL, output_card_id TEXT NOT NULL, snapshot_json TEXT NOT NULL, shown_state TEXT);
  CREATE INDEX IF NOT EXISTS vh_canvas_takes_project ON vh_canvas_takes(project_id, run_id);`);
const view = (row: Row): CanvasTake => ({ jobId: row.job_id, projectId: row.project_id, runId: row.run_id, cardId: row.card_id,
  outputCardId: row.output_card_id, snapshot: JSON.parse(row.snapshot_json) as CanvasGenerationSnapshot, shownState: row.shown_state });

export function recordCanvasTakes(db: DatabaseSync, takes: Omit<CanvasTake, 'shownState'>[]) {
  ensure(db);
  const insert = db.prepare('INSERT OR IGNORE INTO vh_canvas_takes(job_id,project_id,run_id,card_id,output_card_id,snapshot_json,shown_state) VALUES(?,?,?,?,?,?,NULL)');
  for (const take of takes) insert.run(take.jobId, take.projectId, take.runId, take.cardId, take.outputCardId, JSON.stringify(take.snapshot));
}

export function readCanvasTakes(db: DatabaseSync, projectId: string) {
  ensure(db);
  return (db.prepare('SELECT * FROM vh_canvas_takes WHERE project_id=? ORDER BY rowid').all(projectId) as unknown as Row[]).map(view);
}

/** Records what the canvas now shows for a take; outputCardId changes when a cached result reuses an existing take. */
export function markCanvasTake(db: DatabaseSync, jobId: string, shownState: string, outputCardId?: string) {
  ensure(db);
  db.prepare('UPDATE vh_canvas_takes SET shown_state=?, output_card_id=COALESCE(?, output_card_id) WHERE job_id=?').run(shownState, outputCardId ?? null, jobId);
}
