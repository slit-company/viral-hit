import { openHarness } from '../harness/store';

const TABLE = 'CREATE TABLE IF NOT EXISTS vh_character_swaps (request_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, clip_id TEXT NOT NULL, model_id TEXT NOT NULL, character_id TEXT, image_ids_json TEXT NOT NULL, keep_sound INTEGER NOT NULL, prompt TEXT NOT NULL, pieces_json TEXT NOT NULL, evaluations_json TEXT, created_at INTEGER NOT NULL, placed_at INTEGER)';

/** The harness database with the swap records table; close it when done. */
export function openSwapRecords() {
  const h = openHarness();
  h.db.exec(TABLE);
  return h;
}
