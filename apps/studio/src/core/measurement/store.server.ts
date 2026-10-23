import { createHash, randomUUID } from 'node:crypto';
import { constants, closeSync, openSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { getViralHitDataRoot } from '../../config/data-root';
import { canonicalJson } from '../../lib/canonical-json';
import { mediaPath, privateMediaRoot } from '../publishing/media-files.server';
import type { MeasurementIssue, MeasurementSnapshot, MeasurementState } from './contract';

type Row = { id: string; project_id: string; publication_id: string; sequence: number; source: 'connector' | 'manual'; connector: string; connector_version: string; actor: string;
  state: MeasurementState; issue: MeasurementIssue | null; metrics_json: string; missing_json: string; note: string | null; observed_at: number; collected_at: number; request_digest: string | null };
export type NewMeasurement = Omit<MeasurementSnapshot, 'id' | 'sequence' | 'collectedAt'> & { requestKey?: string };
const snapshot = (row: Row): MeasurementSnapshot => ({
  id: row.id, projectId: row.project_id, publicationId: row.publication_id, sequence: row.sequence, source: row.source,
  connector: row.connector, connectorVersion: row.connector_version, actor: row.actor, state: row.state, issue: row.issue,
  metrics: JSON.parse(row.metrics_json), missing: JSON.parse(row.missing_json), note: row.note, observedAt: row.observed_at, collectedAt: row.collected_at,
});

/** Append-only observations. A new reading never edits an earlier one or the published media. */
export class MeasurementStore {
  private db: DatabaseSync;
  constructor(file: string, private now = Date.now) {
    this.db = new DatabaseSync(file);
    try {
      this.db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS measurements (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, publication_id TEXT NOT NULL, sequence INTEGER NOT NULL,
        source TEXT NOT NULL, connector TEXT NOT NULL, connector_version TEXT NOT NULL, actor TEXT NOT NULL,
        state TEXT NOT NULL, issue TEXT, metrics_json TEXT NOT NULL, missing_json TEXT NOT NULL, note TEXT,
        observed_at INTEGER NOT NULL, collected_at INTEGER NOT NULL, request_key TEXT, request_digest TEXT,
        UNIQUE(publication_id, sequence), UNIQUE(project_id, request_key));
      CREATE INDEX IF NOT EXISTS measurement_history ON measurements(project_id, publication_id, sequence);`);
    } catch (error) { this.db.close(); throw error; }
  }
  close() { this.db.close(); }
  private transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const value = fn(); this.db.exec('COMMIT'); return value; }
    catch (error) { if (this.db.isTransaction) this.db.exec('ROLLBACK'); throw error; }
  }
  /** A repeated manual request key returns its original observation; different content is a conflict. */
  append(input: NewMeasurement) {
    const { requestKey, ...value } = input;
    const metrics = JSON.stringify(value.metrics), missing = JSON.stringify(value.missing);
    if (metrics.length > 8000 || missing.length > 4000) throw new Error('Measurement exceeds its size limit');
    const digest = requestKey ? createHash('sha256').update(canonicalJson({ publicationId: value.publicationId, metrics: value.metrics, observedAt: value.observedAt, note: value.note })).digest('hex') : null;
    return this.transaction(() => {
      if (requestKey) {
        const prior = this.db.prepare('SELECT * FROM measurements WHERE project_id=? AND request_key=?').get(value.projectId, requestKey) as Row | undefined;
        if (prior) {
          if (prior.request_digest !== digest) throw new Error('Request key is bound to a different measurement');
          return snapshot(prior);
        }
      }
      const { next } = this.db.prepare('SELECT COALESCE(MAX(sequence),0)+1 AS next FROM measurements WHERE publication_id=?').get(value.publicationId) as { next: number };
      const id = randomUUID();
      this.db.prepare(`INSERT INTO measurements(id,project_id,publication_id,sequence,source,connector,connector_version,actor,state,issue,metrics_json,missing_json,note,observed_at,collected_at,request_key,request_digest)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, value.projectId, value.publicationId, next, value.source, value.connector, value.connectorVersion, value.actor,
        value.state, value.issue, metrics, missing, value.note, value.observedAt, this.now(), requestKey ?? null, digest);
      return snapshot(this.db.prepare('SELECT * FROM measurements WHERE id=?').get(id) as Row);
    });
  }
  history(projectId: string, publicationId: string, limit = 100) {
    return (this.db.prepare('SELECT * FROM measurements WHERE project_id=? AND publication_id=? ORDER BY sequence DESC LIMIT ?').all(projectId, publicationId, limit) as Row[]).map(snapshot);
  }
  lastCollection(projectId: string, publicationId: string) {
    const row = this.db.prepare("SELECT * FROM measurements WHERE project_id=? AND publication_id=? AND source='connector' ORDER BY sequence DESC LIMIT 1").get(projectId, publicationId) as Row | undefined;
    return row ? snapshot(row) : null;
  }
  /** Latest two usable observations per publication, for comparison across a project. */
  recent(projectId: string) {
    const rows = this.db.prepare(`SELECT * FROM (SELECT *, ROW_NUMBER() OVER (PARTITION BY publication_id ORDER BY sequence DESC) AS position
      FROM measurements WHERE project_id=? AND state!='unavailable') WHERE position<=2 ORDER BY publication_id, sequence DESC`).all(projectId) as Row[];
    const result = new Map<string, MeasurementSnapshot[]>();
    for (const row of rows) result.set(row.publication_id, [...(result.get(row.publication_id) ?? []), snapshot(row)]);
    return result;
  }
  /** Most recent attempt of any kind, so unavailable readings remain visible. */
  attempts(projectId: string) {
    const rows = this.db.prepare(`SELECT * FROM (SELECT *, ROW_NUMBER() OVER (PARTITION BY publication_id ORDER BY sequence DESC) AS position
      FROM measurements WHERE project_id=?) WHERE position=1`).all(projectId) as Row[];
    return new Map(rows.map(row => [row.publication_id, snapshot(row)]));
  }
}

export function openMeasurements(directory = resolve(getViralHitDataRoot(), 'publications')) {
  const root = privateMediaRoot(directory), file = mediaPath(root, ['measurements.sqlite']);
  for (const suffix of ['-wal', '-shm']) mediaPath(root, [`measurements.sqlite${suffix}`]);
  try { closeSync(openSync(file, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  return new MeasurementStore(file);
}
