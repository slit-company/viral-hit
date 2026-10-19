import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { canonicalJson, type JsonValue } from '../../lib/canonical-json';
import { publicationSpecSchema, type PublicationSpec, type PublicationRecord, type PublicationState, type PublicationIssue } from './contracts';

type Row = { id: string; spec_json: string; digest: string; revision: number; state: PublicationState; approval_json: string | null; checkpoint_json: string | null; receipt_json: string | null; issue: PublicationIssue; next_poll: number; lease_token: string | null; lease_until: number; created_at: number; updated_at: number };
const digest = (value: JsonValue) => createHash('sha256').update(canonicalJson(value)).digest('hex');
function bounded(value: unknown) {
  const json = JSON.stringify(value);
  if (!json || Buffer.byteLength(json) > 128_000) throw new Error('Publication data exceeds 128 KB');
  return json;
}
function specOf(raw: unknown) { bounded(raw); const spec = publicationSpecSchema.parse(raw); bounded(spec); return spec; }
function record(row: Row): PublicationRecord {
  return { id: row.id, spec: JSON.parse(row.spec_json), digest: row.digest, revision: row.revision, state: row.state,
    approval: row.approval_json ? JSON.parse(row.approval_json) : null, checkpoint: row.checkpoint_json ? JSON.parse(row.checkpoint_json) : null,
    receipt: row.receipt_json ? JSON.parse(row.receipt_json) : null, issue: row.issue, nextPoll: row.next_poll,
    leaseToken: row.lease_token, leaseUntil: row.lease_until, createdAt: row.created_at, updatedAt: row.updated_at };
}

/** Owns publication state only. Network and media reads happen outside transactions. */
export class PublicationStore {
  private db: DatabaseSync;
  constructor(file: string, private now = Date.now) {
    this.db = new DatabaseSync(file);
    try {
      this.db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS publications (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, request_key TEXT NOT NULL, creation_digest TEXT NOT NULL,
        spec_json TEXT NOT NULL, digest TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, state TEXT NOT NULL,
        approval_json TEXT, checkpoint_json TEXT, receipt_json TEXT, issue TEXT,
        next_poll INTEGER NOT NULL DEFAULT 0, lease_token TEXT, lease_until INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, UNIQUE(project_id, request_key));
      CREATE INDEX IF NOT EXISTS publication_queue ON publications(state,next_poll,lease_until);
      CREATE TABLE IF NOT EXISTS publication_events (id INTEGER PRIMARY KEY, publication_id TEXT NOT NULL, state TEXT NOT NULL, issue TEXT, at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS publication_event_history ON publication_events(publication_id,id);`);
      this.transaction(() => {
        const columns = this.db.prepare('PRAGMA table_info(publications)').all();
        if (!columns.some(column => column.name === 'admission_digest')) this.db.exec('ALTER TABLE publications ADD COLUMN admission_digest TEXT');
      });
    } catch (error) { this.db.close(); throw error; }
  }
  close() { this.db.close(); }
  private transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const value = fn(); this.db.exec('COMMIT'); return value; }
    catch (error) { if (this.db.isTransaction) this.db.exec('ROLLBACK'); throw error; }
  }
  private event(id: string, state: PublicationState, issue: PublicationIssue = null) {
    this.db.prepare('INSERT INTO publication_events(publication_id,state,issue,at) VALUES(?,?,?,?)').run(id, state, issue, this.now());
  }
  get(projectId: string, id: string) {
    const row = this.db.prepare('SELECT * FROM publications WHERE id=? AND project_id=?').get(id, projectId) as Row | undefined;
    return row ? record(row) : null;
  }
  list(projectId: string) {
    return (this.db.prepare('SELECT * FROM publications WHERE project_id=? ORDER BY created_at DESC LIMIT 200').all(projectId) as Row[]).map(record);
  }
  events(projectId: string, id: string) {
    if (!this.get(projectId, id)) throw new Error('Publication not found');
    return this.db.prepare('SELECT state,issue,at FROM publication_events WHERE publication_id=? ORDER BY id').all(id);
  }
  findRequest(projectId: string, requestKey: string) {
    const row = this.db.prepare('SELECT * FROM publications WHERE project_id=? AND request_key=?').get(projectId, requestKey) as (Row & { admission_digest: string | null }) | undefined;
    return row ? { record: record(row), admissionDigest: row.admission_digest } : null;
  }
  create(raw: unknown, requestKey: string, admissionDigest?: string) {
    const spec = specOf(raw), hash = digest(spec);
    if (admissionDigest !== undefined && !/^[a-f0-9]{64}$/.test(admissionDigest)) throw new Error('Invalid publication admission digest');
    if (!/^[a-zA-Z0-9_.:-]{1,200}$/.test(requestKey)) throw new Error('Invalid publication request key');
    return this.transaction(() => {
      const prior = this.db.prepare('SELECT * FROM publications WHERE project_id=? AND request_key=?').get(spec.projectId, requestKey) as (Row & { creation_digest: string; admission_digest: string | null }) | undefined;
      if (prior) {
        if (prior.creation_digest !== hash || (admissionDigest !== undefined && prior.admission_digest !== admissionDigest)) throw new Error('Publication request key is bound to different content');
        return record(prior);
      }
      const id = randomUUID(), now = this.now();
      this.db.prepare("INSERT INTO publications(id,project_id,request_key,creation_digest,spec_json,digest,state,created_at,updated_at,admission_digest) VALUES(?,?,?,?,?,?,'draft',?,?,?)").run(id, spec.projectId, requestKey, hash, bounded(spec), hash, now, now, admissionDigest ?? null);
      this.event(id, 'draft'); return this.get(spec.projectId, id)!;
    });
  }
  revise(projectId: string, id: string, expectedRevision: number, raw: unknown) {
    const spec = specOf(raw);
    if (spec.projectId !== projectId) throw new Error('Publication cannot move to another project');
    return this.transaction(() => {
      const prior = this.require(projectId, id, expectedRevision);
      if (!['draft', 'approved'].includes(prior.state) || prior.leaseUntil > this.now()) throw new Error('Started publication is immutable');
      this.db.prepare("UPDATE publications SET spec_json=?,digest=?,revision=revision+1,state='draft',approval_json=NULL,issue=NULL,updated_at=? WHERE id=?").run(bounded(spec), digest(spec), this.now(), id);
      this.event(id, 'draft'); return this.get(projectId, id)!;
    });
  }
  approve(projectId: string, id: string, expectedRevision: number, expectedDigest: string, actor: string) {
    if (!actor.trim() || actor.length > 128) throw new Error('An approval actor is required');
    return this.transaction(() => {
      const prior = this.require(projectId, id, expectedRevision);
      if (prior.digest !== expectedDigest) throw new Error('Publication changed after review');
      if (prior.state === 'approved' && prior.approval?.digest === expectedDigest) return prior;
      if (prior.state !== 'draft') throw new Error('Only a draft can be approved');
      const approval = { digest: prior.digest, revision: prior.revision, actor, at: this.now() };
      this.db.prepare("UPDATE publications SET state='approved',approval_json=?,updated_at=? WHERE id=?").run(bounded(approval), this.now(), id);
      this.event(id, 'approved'); return this.get(projectId, id)!;
    });
  }
  private require(projectId: string, id: string, revision: number) {
    const prior = this.get(projectId, id);
    if (!prior) throw new Error('Publication not found');
    if (prior.revision !== revision) throw new Error('Publication revision conflict');
    return prior;
  }
  stop(projectId: string, id: string, revision: number) {
    return this.transaction(() => {
      const prior = this.require(projectId, id, revision);
      if (['published', 'ready', 'failed', 'canceled'].includes(prior.state)) return prior;
      const state = ['draft', 'approved'].includes(prior.state) ? 'canceled' : 'uncertain';
      // Fence the writer immediately, but retain its lease as a quarantine for in-flight I/O.
      this.db.prepare('UPDATE publications SET state=?,issue=?,lease_token=NULL,updated_at=? WHERE id=?').run(state, state === 'uncertain' ? 'stopped' : null, this.now(), id);
      this.event(id, state, state === 'uncertain' ? 'stopped' : null); return this.get(projectId, id)!;
    });
  }
  reconcile(projectId: string, id: string, revision: number) {
    return this.transaction(() => {
      const prior = this.require(projectId, id, revision);
      if (prior.state !== 'uncertain' || (prior.checkpoint === null && prior.receipt === null)) throw new Error('No original remote identity is available for reconciliation');
      this.db.prepare("UPDATE publications SET state='reconciling',next_poll=0,updated_at=? WHERE id=?").run(this.now(), id);
      this.event(id, 'reconciling'); return this.get(projectId, id)!;
    });
  }
  resume(projectId: string, id: string, revision: number) {
    return this.transaction(() => {
      const prior = this.require(projectId, id, revision);
      if (prior.state !== 'uncertain' || prior.issue !== 'upload-incomplete' || prior.checkpoint === null || prior.approval?.digest !== prior.digest || prior.approval.revision !== prior.revision) throw new Error('Inspect the original incomplete upload before continuing it');
      this.db.prepare("UPDATE publications SET state='uploading',issue=NULL,next_poll=0,updated_at=? WHERE id=?").run(this.now(), id);
      this.event(id, 'uploading'); return this.get(projectId, id)!;
    });
  }
  claim(): PublicationRecord | null {
    return this.transaction(() => {
      const row = this.db.prepare("SELECT * FROM publications WHERE state IN ('approved','starting','uploading','accepted','processing','staged','publishing','scheduled','reconciling') AND next_poll<=? AND lease_until<=? ORDER BY created_at,id LIMIT 1").get(this.now(), this.now()) as Row | undefined;
      if (!row) return null;
      const token = randomUUID();
      this.db.prepare('UPDATE publications SET lease_token=?,lease_until=? WHERE id=?').run(token, this.now() + 120000, row.id);
      return { ...record(row), leaseToken: token, leaseUntil: this.now() + 120000 };
    });
  }
  /** Starting must be committed before contacting a non-idempotent session endpoint. */
  begin(claim: PublicationRecord) {
    return this.transaction(() => {
      const current = this.get(claim.spec.projectId, claim.id);
      if (!current || current.state !== 'approved' || current.leaseToken !== claim.leaseToken || current.leaseUntil <= this.now() || current.approval?.digest !== current.digest || current.approval.revision !== current.revision) return false;
      this.db.prepare("UPDATE publications SET state='starting',updated_at=? WHERE id=?").run(this.now(), claim.id);
      this.event(claim.id, 'starting'); return true;
    });
  }
  checkpoint(claim: PublicationRecord, value: JsonValue) { return this.finish(claim, 'uploading', { checkpoint: value }); }
  /** The original container receipt survives a lost media_publish response. */
  beginPublish(claim: PublicationRecord) {
    return this.transaction(() => {
      const current = this.get(claim.spec.projectId, claim.id);
      if (!current || current.state !== 'staged' || current.receipt === null || current.digest !== claim.digest || current.leaseToken !== claim.leaseToken || current.leaseUntil <= this.now() || current.approval?.digest !== current.digest || current.approval.revision !== current.revision) return false;
      this.db.prepare("UPDATE publications SET state='publishing',updated_at=? WHERE id=?").run(this.now(), claim.id);
      this.event(claim.id, 'publishing'); return true;
    });
  }
  finish(claim: PublicationRecord, state: PublicationState, patch: { checkpoint?: JsonValue; receipt?: JsonValue; issue?: PublicationIssue; delayMs?: number } = {}) {
    const checkpoint = patch.checkpoint === undefined ? null : bounded(patch.checkpoint), receipt = patch.receipt === undefined ? null : bounded(patch.receipt);
    const delay = Math.min(86400000, Math.max(0, patch.delayMs ?? 0));
    if (!Number.isFinite(delay)) throw new Error('Invalid publication delay');
    return this.transaction(() => {
      const previous = this.get(claim.spec.projectId, claim.id);
      const result = this.db.prepare(`UPDATE publications SET state=?,checkpoint_json=COALESCE(?,checkpoint_json),receipt_json=COALESCE(?,receipt_json),issue=?,next_poll=?,lease_token=NULL,lease_until=0,updated_at=?
        WHERE id=? AND project_id=? AND lease_token=? AND lease_until>? AND digest=?`).run(state, checkpoint, receipt, patch.issue ?? null, this.now() + delay, this.now(), claim.id, claim.spec.projectId, claim.leaseToken, this.now(), claim.digest);
      // Repeated probes/progress update the row, not an ever-growing idle event log.
      if (result.changes && (previous?.state !== state || previous.issue !== (patch.issue ?? null))) this.event(claim.id, state, patch.issue ?? null);
      return result.changes === 1;
    });
  }
}
