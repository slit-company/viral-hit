import { createHash } from 'node:crypto';
import { canonicalJson } from '@/lib/canonical-json';
import { loadProjects } from '../projects/projects';
import type { DurableHarness } from '../harness/durable';
import { openHarness } from '../harness/store';
import * as records from './agent-records.server';
import { agentAction, type AgentOverview, type ApprovalStep, type ApprovalView } from './contract';
import { currentAgent } from './request-origin.server';

/** An agent's generation waits for a person, or a person rejected it. */
export class AgentApprovalRequired extends Error {
  constructor(readonly approval: ApprovalView) {
    super(approval.state === 'rejected'
      ? `A person rejected this generation (approval ${approval.id}). Change the request or ask them before trying again.`
      : `Viral Hit asks before generating. Approval ${approval.id} is waiting on the Agent page in Viral Hit. After a person approves it, call this tool again with the same arguments; check it with viral_hit_approvals.`);
    this.name = 'AgentApprovalRequired';
  }
}

const withHarness = <T>(work: (h: DurableHarness) => T): T => {
  const h = openHarness();
  try { return work(h); } finally { h.close(); }
};

async function projectNames() {
  try {
    const projects = (await loadProjects({ limit: 200 })) as Array<{ id: string; name: string }>;
    return new Map(projects.map((project) => [project.id, project.name]));
  } catch { return new Map<string, string>(); }
}

export async function readAgentOverview(): Promise<AgentOverview> {
  const names = await projectNames();
  const name = (projectId: string | null) => (projectId ? names.get(projectId) ?? null : null);
  return withHarness((h) => ({
    mode: records.readApprovalMode(h.db),
    pending: records.listApprovals(h.db, { states: ['pending'], limit: 100 }).map((item) => ({ ...item, projectName: name(item.projectId) })),
    recent: records.listApprovals(h.db, { states: ['approved', 'rejected', 'used'], limit: 20 }).map((item) => ({ ...item, projectName: name(item.projectId) })),
    memory: records.listMemory(h.db).map((item) => ({ ...item, projectName: name(item.projectId) })),
  }));
}

/** Approve releases a held run (or lets the agent's repeated call through); reject cancels it. */
function decide(h: DurableHarness, id: string, decision: 'approve' | 'reject') {
  const existing = records.readApproval(h.db, id);
  if (!existing) throw new Error('Approval not found.');
  if (existing.state !== 'pending') return existing;
  const settled = records.settleApproval(h.db, id, decision === 'approve' ? 'approved' : 'rejected')!;
  if (settled.kind === 'run' && settled.runId) {
    if (settled.state === 'approved') h.release(settled.runId);
    else if (settled.state === 'rejected') h.cancel(settled.runId);
  }
  return settled;
}

/** Settings and approvals belong to the person; memory can be written by both. */
export function changeAgent(raw: unknown, actor: 'person' | 'agent') {
  const action = agentAction.parse(raw);
  if ((action.action === 'set_mode' || action.action === 'decide') && actor !== 'person') throw new Error('Only a person can change approvals in Viral Hit.');
  return withHarness((h) => {
    if (action.action === 'set_mode') { records.writeApprovalMode(h.db, action.mode); return { mode: action.mode }; }
    if (action.action === 'decide') return { approval: decide(h, action.id, action.decision) };
    if (action.action === 'remember') return { memory: records.saveMemory(h.db, { id: action.id, projectId: action.projectId, text: action.text, source: actor }) };
    if (!records.forgetMemory(h.db, action.id)) throw new Error('Memory entry not found.');
    return { forgotten: action.id };
  });
}

export const readAgentMemory = (projectId: string | null) => withHarness((h) => records.listMemory(h.db, projectId));
export const readApprovalMode = () => withHarness((h) => records.readApprovalMode(h.db));
/** The header badge: whether asking is on and how many approvals wait. */
export const readApprovalBadge = () => withHarness((h) => ({ mode: records.readApprovalMode(h.db), pending: records.countPendingApprovals(h.db) }));
export function readApprovals(state: 'pending' | 'all') {
  return withHarness((h) => records.listApprovals(h.db, { states: state === 'pending' ? ['pending'] : ['pending', 'approved', 'rejected', 'used'], limit: 50 }));
}
export const readApproval = (id: string) => withHarness((h) => records.readApproval(h.db, id));

/**
 * Gate for generation an agent submits directly (not through a queued run). With asking on, the first
 * call records a pending approval and stops; once a person approves, the same call goes through once.
 * A repeated call with the same idempotency key after that replays as the original submission.
 */
export function requireAgentApproval({ projectId, gate, request, key, steps }: {
  /** gate names the submission path, so the same request through another path is approved separately. */
  projectId: string; gate: string; request: unknown; key: string | null; steps: ApprovalStep[];
}) {
  const agent = currentAgent();
  if (!agent) return;
  withHarness((h) => {
    if (records.readApprovalMode(h.db) !== 'ask') return;
    const fingerprint = createHash('sha256').update(canonicalJson({ gate, projectId, request, key } as never)).digest('hex');
    const latest = records.latestApprovalFor(h.db, fingerprint);
    if (latest?.state === 'approved' && records.consumeApproval(h.db, latest.id)) return;
    if (latest?.state === 'used' && key) return;
    if (latest && latest.state !== 'used') throw new AgentApprovalRequired(latest);
    throw new AgentApprovalRequired(records.insertApproval(h.db, { projectId, kind: 'request', fingerprint, channel: agent.channel, tool: agent.tool, steps }));
  });
}
