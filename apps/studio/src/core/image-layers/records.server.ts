import { openHarness } from '../harness/store';
import type { ImageLayer, ImageLayerStack } from './contract';

const TABLE = 'CREATE TABLE IF NOT EXISTS vh_image_layer_stacks (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL, layers_json TEXT NOT NULL, revision INTEGER NOT NULL, flattened_asset_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)';
type Row = { id: string; name: string; width: number; height: number; layers_json: string; revision: number; flattened_asset_id: string | null; created_at: number; updated_at: number };
type Db = ReturnType<typeof openHarness>['db'];

function withStacks<T>(run: (db: Db) => T): T {
  const h = openHarness();
  try { h.db.exec(TABLE); return run(h.db); } finally { h.close(); }
}
const view = (row: Row): ImageLayerStack => ({ id: row.id, name: row.name, width: row.width, height: row.height, revision: row.revision,
  layers: JSON.parse(row.layers_json) as ImageLayer[], flattenedAssetId: row.flattened_asset_id, createdAt: row.created_at, updatedAt: row.updated_at });

export const listStacks = (projectId: string) => withStacks(db =>
  (db.prepare('SELECT * FROM vh_image_layer_stacks WHERE project_id = ? ORDER BY updated_at DESC LIMIT 100').all(projectId) as Row[]).map(view));
export const readStack = (projectId: string, stackId: string) => withStacks(db => {
  const row = db.prepare('SELECT * FROM vh_image_layer_stacks WHERE project_id = ? AND id = ?').get(projectId, stackId) as Row | undefined;
  return row ? view(row) : null;
});
export const insertStack = (projectId: string, stack: ImageLayerStack) => withStacks(db => {
  db.prepare('INSERT INTO vh_image_layer_stacks VALUES (?,?,?,?,?,?,?,?,?,?)').run(stack.id, projectId, stack.name, stack.width, stack.height,
    JSON.stringify(stack.layers), stack.revision, null, stack.createdAt, stack.updatedAt);
});
/** Saves only over the expected revision; false means another edit was saved first. */
export const updateStack = (projectId: string, stackId: string, expected: number, name: string, layers: ImageLayer[]) => withStacks(db =>
  Number(db.prepare('UPDATE vh_image_layer_stacks SET name = ?, layers_json = ?, revision = revision + 1, flattened_asset_id = NULL, updated_at = ? WHERE project_id = ? AND id = ? AND revision = ?')
    .run(name, JSON.stringify(layers), Date.now(), projectId, stackId, expected).changes) === 1);
export const recordFlattened = (projectId: string, stackId: string, revision: number, assetId: string) => withStacks(db => {
  db.prepare('UPDATE vh_image_layer_stacks SET flattened_asset_id = ? WHERE project_id = ? AND id = ? AND revision = ?').run(assetId, projectId, stackId, revision);
});
export const deleteStack = (projectId: string, stackId: string) => withStacks(db =>
  Number(db.prepare('DELETE FROM vh_image_layer_stacks WHERE project_id = ? AND id = ?').run(projectId, stackId).changes) === 1);
