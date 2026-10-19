import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { bindOutputs, BindingError, validateBindings, type OutputBinding } from './bindings';

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type NodeSpec = { id: string; operation: string; version: string; input: Json; dependsOn?: string[]; cache?: boolean; bindings?: OutputBinding[] };
export type Plan = { projectId: string; nodes: NodeSpec[] };
export type State = 'queued' | 'submitting' | 'running' | 'succeeded' | 'failed' | 'uncertain' | 'canceled' | 'blocked';
export type Job = {
  id: string; run_id: string; node_id: string; operation: string; fingerprint: string;
  input_json: string; dependencies_json: string; state: State; provider_id: string | null;
  idempotency_key: string; attempts: number; lease_token: string | null; lease_until: number;
  next_poll: number; cancel_requested: number; output_json: string | null; error: string | null;
  cacheable: number; cached_from: string | null;
  bindings_json: string; execution_input_json: string | null;
};
export type Poll = { state: 'running' | 'succeeded' | 'failed' | 'canceled'; output?: Json; error?: string; retryAfterMs?: number };
export interface Adapter {
  /** replay: repeated submission with the SAME key returns the same paid job. */
  recovery: 'replay' | 'manual';
  submit(input: Json, context: { key: string; dependencies: Record<string, Json>; signal: AbortSignal; projectId?: string; runId?: string; jobId?: string }): Promise<{ id: string }>;
  poll(id: string, input: Json, signal: AbortSignal, context?: { projectId: string; runId: string; jobId: string }): Promise<Poll>;
  /** Must request cancellation, not pretend the remote job has stopped. */
  cancel?(id: string, input: Json, signal: AbortSignal): Promise<void>;
}
export class RejectedSubmission extends Error {}

function canonical(value: Json): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Non-finite input');
  return JSON.stringify(value);
}
export const fingerprint = (value: Json) => createHash('sha256').update(canonical(value)).digest('hex');

export function compilePlan(plan: Plan) {
  if (!plan.projectId?.trim() || !Array.isArray(plan.nodes) || !plan.nodes.length || plan.nodes.length > 256) throw new Error('A project and 1–256 nodes are required');
  const nodes = new Map<string, NodeSpec>();
  for (const n of plan.nodes) {
    if (!n.id?.trim() || !n.operation?.trim() || !n.version?.trim() || nodes.has(n.id)) throw new Error('Invalid or duplicate node');
    if (n.input === undefined || (n.dependsOn && new Set(n.dependsOn).size !== n.dependsOn.length)) throw new Error('Invalid node inputs');
    nodes.set(n.id, n);
    validateBindings(n.input, n.dependsOn ?? [], n.bindings ?? []);
  }
  const visiting = new Set<string>(), hashes = new Map<string, string>();
  const visit = (id: string): string => {
    if (hashes.has(id)) return hashes.get(id)!;
    const n = nodes.get(id);
    if (!n) throw new Error(`Missing dependency: ${id}`);
    if (visiting.has(id)) throw new Error(`Cycle at ${id}`);
    visiting.add(id);
    const deps = Object.fromEntries([...(n.dependsOn ?? [])].sort().map(d => [d, visit(d)]));
    const hash = fingerprint({ operation: n.operation, version: n.version, input: n.input, dependencies: deps, bindings: (n.bindings ?? []) as unknown as Json });
    visiting.delete(id); hashes.set(id, hash); return hash;
  };
  for (const n of plan.nodes) visit(n.id);
  return hashes;
}

/** Durable local worker queue. External calls never run inside SQLite transactions. */
export class DurableHarness {
  readonly db: DatabaseSync;
  constructor(file: string, private now = Date.now) {
    this.db = new DatabaseSync(file);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS vh_runs(id TEXT PRIMARY KEY, project_id TEXT NOT NULL, request_key TEXT NOT NULL, plan_hash TEXT NOT NULL, created_at INTEGER NOT NULL, UNIQUE(project_id,request_key));
      CREATE TABLE IF NOT EXISTS vh_jobs(
        id TEXT PRIMARY KEY, run_id TEXT NOT NULL, node_id TEXT NOT NULL, operation TEXT NOT NULL,
        fingerprint TEXT NOT NULL, input_json TEXT NOT NULL, dependencies_json TEXT NOT NULL,
        state TEXT NOT NULL, provider_id TEXT, idempotency_key TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
        lease_token TEXT, lease_until INTEGER NOT NULL DEFAULT 0, next_poll INTEGER NOT NULL DEFAULT 0,
        cancel_requested INTEGER NOT NULL DEFAULT 0, output_json TEXT, error TEXT,
        cacheable INTEGER NOT NULL DEFAULT 0, cached_from TEXT, UNIQUE(run_id,node_id));
      CREATE INDEX IF NOT EXISTS vh_jobs_fingerprint ON vh_jobs(fingerprint,state);
      CREATE TABLE IF NOT EXISTS vh_events(sequence INTEGER PRIMARY KEY AUTOINCREMENT,run_id TEXT NOT NULL,job_id TEXT NOT NULL,at INTEGER NOT NULL,event TEXT NOT NULL,detail TEXT NOT NULL);`);
    this.transaction(() => {
      const columns = this.db.prepare('PRAGMA table_info(vh_jobs)').all().map(column => column.name);
      if (!columns.includes('bindings_json')) this.db.exec("ALTER TABLE vh_jobs ADD COLUMN bindings_json TEXT NOT NULL DEFAULT '[]'");
      if (!columns.includes('execution_input_json')) this.db.exec('ALTER TABLE vh_jobs ADD COLUMN execution_input_json TEXT');
    });
  }
  close() { this.db.close(); }
  private transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const value = fn(); this.db.exec('COMMIT'); return value; }
    catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  private event(job: Pick<Job, 'run_id' | 'id'>, event: string, detail: Json = {}) {
    this.db.prepare('INSERT INTO vh_events(run_id,job_id,at,event,detail) VALUES(?,?,?,?,?)').run(job.run_id, job.id, this.now(), event, JSON.stringify(detail));
  }
  enqueue(plan: Plan, requestKey: string) {
    if (!requestKey.trim() || requestKey.length > 200) throw new Error('A stable request key is required');
    const hashes = compilePlan(plan);
    const planHash = fingerprint(plan as unknown as Json);
    return this.transaction(() => {
      const existing = this.db.prepare('SELECT id,plan_hash FROM vh_runs WHERE project_id=? AND request_key=?').get(plan.projectId, requestKey) as { id: string; plan_hash: string } | undefined;
      if (existing) {
        if (existing.plan_hash !== planHash) throw new Error('Request key already belongs to a different plan');
        return existing.id;
      }
      const runId = randomUUID();
      this.db.prepare('INSERT INTO vh_runs VALUES(?,?,?,?,?)').run(runId, plan.projectId, requestKey, planHash, this.now());
      const nodeMap = new Map(plan.nodes.map(n => [n.id, n]));
      const cacheFlags = new Map<string, boolean>();
      const cacheable = (node: NodeSpec): boolean => {
        if (cacheFlags.has(node.id)) return cacheFlags.get(node.id)!;
        const result = Boolean(node.cache && (node.dependsOn ?? []).every(id => cacheable(nodeMap.get(id)!)));
        cacheFlags.set(node.id, result); return result;
      };
      for (const node of plan.nodes) {
        const canCache = cacheable(node);
        const cached = canCache ? this.db.prepare(`SELECT j.id,j.output_json FROM vh_jobs j JOIN vh_runs r ON r.id=j.run_id
          WHERE r.project_id=? AND j.fingerprint=? AND j.state='succeeded' AND j.cacheable=1 AND j.cancel_requested=0 ORDER BY r.created_at DESC LIMIT 1`).get(plan.projectId, hashes.get(node.id)!) as { id: string; output_json: string } | undefined : undefined;
        const id = randomUUID();
        this.db.prepare(`INSERT INTO vh_jobs(id,run_id,node_id,operation,fingerprint,input_json,dependencies_json,state,idempotency_key,output_json,cacheable,cached_from,bindings_json)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, runId, node.id, node.operation, hashes.get(node.id)!, JSON.stringify(node.input), JSON.stringify(node.dependsOn ?? []), cached ? 'succeeded' : 'queued', randomUUID(), cached?.output_json ?? null, canCache ? 1 : 0, cached?.id ?? null, JSON.stringify(node.bindings ?? []));
        this.event({ id, run_id: runId }, cached ? 'cache_hit' : 'queued', { node: node.id });
      }
      return runId;
    });
  }
  jobs(runId: string): Job[] { return this.db.prepare('SELECT * FROM vh_jobs WHERE run_id=? ORDER BY rowid').all(runId) as unknown as Job[]; }
  runs(projectId: string) { return this.db.prepare('SELECT * FROM vh_runs WHERE project_id=? ORDER BY created_at DESC').all(projectId); }
  events(runId: string) { return this.db.prepare('SELECT * FROM vh_events WHERE run_id=? ORDER BY sequence').all(runId); }
  cancel(runId: string) {
    this.transaction(() => {
      for (const job of this.jobs(runId)) {
        if (['succeeded', 'failed', 'canceled', 'blocked'].includes(job.state)) continue;
        const state = job.state === 'queued' ? 'canceled' : job.state;
        this.db.prepare('UPDATE vh_jobs SET cancel_requested=1,state=?,next_poll=0 WHERE id=?').run(state, job.id);
        this.event(job, 'cancel_requested');
      }
    });
  }
  retry(runId: string) {
    this.transaction(() => {
      for (const job of this.jobs(runId)) {
        if (!['failed', 'blocked'].includes(job.state) || job.cancel_requested) continue;
        this.db.prepare('UPDATE vh_jobs SET state=?,error=NULL,attempts=0,next_poll=0 WHERE id=?').run(job.provider_id ? 'running' : 'queued', job.id);
        this.event(job, 'retry_requested');
      }
    });
  }
  private claim(runId: string, pausedOperations: readonly string[] = []): Job | undefined {
    return this.transaction(() => {
      const jobs = this.jobs(runId), byId = new Map(jobs.map(j => [j.node_id, j]));
      for (const job of jobs) {
        if (pausedOperations.includes(job.operation)) continue;
        if (!['queued', 'submitting', 'running'].includes(job.state) || job.lease_until > this.now() || job.next_poll > this.now()) continue;
        const deps = (JSON.parse(job.dependencies_json) as string[]).map(d => byId.get(d)!);
        if (deps.some(d => ['failed', 'uncertain', 'blocked', 'canceled'].includes(d.state))) {
          this.db.prepare("UPDATE vh_jobs SET state='blocked',error='A dependency did not succeed' WHERE id=?").run(job.id);
          this.event(job, 'blocked'); continue;
        }
        if (deps.some(d => d.state !== 'succeeded')) continue;
        const token = randomUUID();
        this.db.prepare('UPDATE vh_jobs SET lease_token=?,lease_until=? WHERE id=?').run(token, this.now() + 120_000, job.id);
        return { ...job, lease_token: token, lease_until: this.now() + 120_000 };
      }
    });
  }
  private transition(job: Job, state: State, patch: { providerId?: string; output?: Json; error?: string; nextPoll?: number } = {}) {
    return this.transaction(() => {
      const result = this.db.prepare(`UPDATE vh_jobs SET state=?, provider_id=COALESCE(?,provider_id), output_json=COALESCE(?,output_json),error=?,next_poll=?,lease_until=0,lease_token=NULL WHERE id=? AND lease_token=?`)
        .run(state, patch.providerId ?? null, patch.output === undefined ? null : JSON.stringify(patch.output), patch.error ?? null, patch.nextPoll ?? 0, job.id, job.lease_token);
      if (result.changes) this.event(job, state, { providerId: patch.providerId ?? job.provider_id, error: patch.error ?? null });
      return Number(result.changes) === 1;
    });
  }
  async step(runId: string, adapters: Record<string, Adapter>, pausedOperations: readonly string[] = []): Promise<boolean> {
    const job = this.claim(runId, pausedOperations); if (!job) return false;
    const adapter = adapters[job.operation];
    if (!adapter) { this.transition(job, 'failed', { error: `No adapter for ${job.operation}` }); return true; }
    let input = JSON.parse(job.execution_input_json ?? job.input_json) as Json;
    const signal = AbortSignal.timeout(60_000);
    try {
      if (!job.provider_id) {
        if (job.state === 'submitting' && adapter.recovery === 'manual') {
          this.transition(job, 'uncertain', { error: 'Submission outcome unknown. Reconcile the provider job before retrying.' }); return true;
        }
        const dependencies = Object.fromEntries(this.jobs(runId).filter(d => (JSON.parse(job.dependencies_json) as string[]).includes(d.node_id)).map(d => [d.node_id, JSON.parse(d.output_json ?? 'null') as Json]));
        if (!job.execution_input_json) input = bindOutputs(input, dependencies, JSON.parse(job.bindings_json) as OutputBinding[]);
        const submitting = this.db.prepare("UPDATE vh_jobs SET state='submitting',attempts=attempts+1,execution_input_json=COALESCE(execution_input_json,?) WHERE id=? AND lease_token=? AND cancel_requested=0").run(JSON.stringify(input), job.id, job.lease_token);
        if (!submitting.changes) { this.transition(job, job.state === 'queued' ? 'canceled' : 'uncertain', { error: 'Canceled before submission; reconcile an earlier ambiguous attempt if present' }); return true; }
        const run = this.db.prepare('SELECT project_id FROM vh_runs WHERE id=?').get(runId)!;
        const submitted = await adapter.submit(input, { key: job.idempotency_key, dependencies, signal, projectId: String(run.project_id), runId, jobId: job.id });
        if (!submitted.id) throw new Error('Provider accepted without a recoverable job ID');
        this.transition(job, 'running', { providerId: submitted.id });
        return true;
      }
      // Cancellation is a request. The next poll establishes its actual outcome.
      const latest = this.jobs(runId).find(j => j.id === job.id)!;
      if (latest.cancel_requested) {
        if (!adapter.cancel) { this.transition(job, 'uncertain', { error: 'Provider cancellation unsupported; remote job may still run' }); return true; }
        try { await adapter.cancel(job.provider_id, input, signal); }
        catch { this.event(job, 'cancel_response_unconfirmed'); }
      }
      const run = this.db.prepare('SELECT project_id FROM vh_runs WHERE id=?').get(runId)!;
      const result = await adapter.poll(job.provider_id, input, signal, { projectId: String(run.project_id), runId, jobId: job.id });
      this.transition(job, result.state, { output: result.output, error: result.error, nextPoll: result.state === 'running' ? this.now() + Math.max(100, result.retryAfterMs ?? 2000) : 0 });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      if (error instanceof RejectedSubmission || error instanceof BindingError) this.transition(job, 'failed', { error: detail });
      else if (job.provider_id) this.transition(job, 'running', { error: detail, nextPoll: this.now() + 5000 });
      else this.transition(job, adapter.recovery === 'manual' || job.attempts >= 2 ? 'uncertain' : 'submitting', { error: detail, nextPoll: this.now() + 2000 });
    }
    return true;
  }
}
