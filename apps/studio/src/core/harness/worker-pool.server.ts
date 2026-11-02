import { availableParallelism, totalmem } from 'node:os';
import type { Adapter, DurableHarness, Job } from './durable';

/** How many steps one worker process runs at once. Remote calls mostly wait; local media work uses CPU. */
export type WorkerLimits = { total: number; perProvider: number; perProject: number; local: number };
const GiB = 1024 ** 3;

/** FFmpeg, probes and scene detection use several threads each, so leave room for the studio itself. */
export function localJobLimit(cpu = availableParallelism(), memory = totalmem()) {
  return Math.max(1, Math.min(4, Math.floor(cpu / 4), Math.floor(memory / (4 * GiB))));
}

const setting = (value: string | undefined, fallback: number, max: number) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 ? Math.min(parsed, max) : fallback;
};

/**
 * perProject stays below the seven pending generation intents a project may hold, so queued
 * shots never crowd out a generation someone starts from the Studio.
 */
export function workerLimits(env: Record<string, string | undefined> = process.env): WorkerLimits {
  return {
    total: setting(env.VIRAL_HIT_WORKER_CONCURRENCY, 8, 32),
    perProvider: setting(env.VIRAL_HIT_PROVIDER_CONCURRENCY, 3, 16),
    perProject: 3,
    local: setting(env.VIRAL_HIT_LOCAL_CONCURRENCY, localJobLimit(), 8),
  };
}

type PinnedInput = { runtime?: { providerId?: unknown; projectId?: unknown } };

/** What a step occupies while it runs: its model service and project, a ComfyUI server, or local capacity. */
export function jobResources(job: Pick<Job, 'operation' | 'input_json' | 'execution_input_json'>): string[] {
  if (job.operation === 'generation.model') {
    let input: PinnedInput = {};
    try { input = JSON.parse(job.execution_input_json ?? job.input_json) as PinnedInput; } catch { /* the adapter rejects malformed input */ }
    const provider = typeof input.runtime?.providerId === 'string' ? input.runtime.providerId : 'unpinned';
    const project = typeof input.runtime?.projectId === 'string' ? input.runtime.projectId : 'unpinned';
    return ['provider:' + provider, 'project:' + project];
  }
  if (job.operation === 'comfy.router') return ['provider:comfy'];
  if (job.operation.startsWith('comfy.')) return ['provider:comfyui'];
  return ['local'];
}

export class WorkerSlots {
  private readonly active = new Map<string, number>();
  private running = 0;
  constructor(private readonly limits: WorkerLimits) {}
  get size() { return this.running; }
  private limit(resource: string) {
    return resource === 'local' ? this.limits.local : resource.startsWith('project:') ? this.limits.perProject : this.limits.perProvider;
  }
  /** Reserves every resource or none. The returned release is safe to call more than once. */
  acquire(resources: readonly string[]): (() => void) | null {
    if (this.running >= this.limits.total || resources.some(resource => (this.active.get(resource) ?? 0) >= this.limit(resource))) return null;
    this.running++;
    for (const resource of resources) this.active.set(resource, (this.active.get(resource) ?? 0) + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.running--;
      for (const resource of resources) {
        const remaining = (this.active.get(resource) ?? 1) - 1;
        if (remaining > 0) this.active.set(resource, remaining); else this.active.delete(resource);
      }
    };
  }
}

/**
 * Starts every claimable step the limits allow, across runs, without waiting for earlier steps.
 * Leases in the durable queue still fence each job to one step; slots only bound how many run at once.
 */
export function createWorkerPool(h: DurableHarness, adapters: Record<string, Adapter>, limits: WorkerLimits = workerLimits()) {
  const slots = new WorkerSlots(limits), inFlight = new Set<Promise<void>>();
  function start(runId: string, paused: readonly string[], onError: (error: unknown) => void) {
    // Claiming is synchronous, so the reservation is known as soon as step() returns its promise.
    const claim: { release?: () => void } = {};
    const step = h.step(runId, adapters, paused, job => {
      claim.release = slots.acquire(jobResources(job)) ?? undefined;
      return claim.release !== undefined;
    });
    const release = claim.release;
    if (!release) { void step.catch(onError); return false; }
    const tracked: Promise<void> = step.then(() => undefined, onError).finally(() => { release(); inFlight.delete(tracked); });
    inFlight.add(tracked);
    return true;
  }
  return {
    get active() { return slots.size; },
    tick(paused: readonly string[], onError: (error: unknown) => void) {
      const runs = h.db.prepare("SELECT DISTINCT run_id FROM vh_jobs WHERE state IN ('queued','submitting','running') ORDER BY rowid").all();
      for (const row of runs) {
        while (slots.size < limits.total && start(String(row.run_id), paused, onError)) { /* claim this run's next job */ }
        if (slots.size >= limits.total) break;
      }
    },
    async drain() { while (inFlight.size) await Promise.allSettled([...inFlight]); },
  };
}
