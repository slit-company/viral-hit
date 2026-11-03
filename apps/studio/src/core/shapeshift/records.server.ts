import { openHarness } from '../harness/store';

const TABLE = 'CREATE TABLE IF NOT EXISTS vh_shapeshifts (request_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, mode TEXT NOT NULL, source_asset_id TEXT NOT NULL, start_seconds REAL NOT NULL, duration_seconds REAL NOT NULL, image_ids_json TEXT NOT NULL, character_id TEXT, style TEXT NOT NULL, prompt TEXT NOT NULL, quality TEXT NOT NULL, keep_sound INTEGER NOT NULL, takes_json TEXT NOT NULL, results_json TEXT, created_at INTEGER NOT NULL)';

/** One stored Shapeshift request; takes and results are JSON in request order. */
export type ShapeshiftRow = {
  request_id: string; project_id: string; mode: string; source_asset_id: string; start_seconds: number; duration_seconds: number; image_ids_json: string;
  character_id: string | null; style: string; prompt: string; quality: string; keep_sound: number; takes_json: string; results_json: string | null; created_at: number;
};

/** The harness database with the Shapeshift table; close it when done. */
export function openShapeshiftRecords() {
  const h = openHarness();
  h.db.exec(TABLE);
  return h;
}
