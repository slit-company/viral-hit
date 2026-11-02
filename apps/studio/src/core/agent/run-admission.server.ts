import type { DatabaseSync } from 'node:sqlite';
import { runtimeCapabilities } from '../harness/capabilities';
import type { Json, NodeSpec, Plan } from '../harness/durable';
import { insertApproval, readApprovalMode } from './agent-records.server';
import type { ApprovalStep } from './contract';
import { currentAgent } from './request-origin.server';

const excerpt = (value: Json | undefined, limit: number) => (typeof value === 'string' && value.trim() ? value.trim().slice(0, limit) : undefined);

/** What each generation step will make, for the person approving it. */
export function describeGenerationSteps(nodes: readonly Pick<NodeSpec, 'operation' | 'input'>[]): ApprovalStep[] {
  const labels = new Map(runtimeCapabilities().map((capability) => [capability.operation, capability.label]));
  return nodes.map((node) => {
    const input = (node.input && typeof node.input === 'object' && !Array.isArray(node.input) ? node.input : {}) as Record<string, Json>;
    return { label: labels.get(node.operation) ?? node.operation, mode: excerpt(input.mode, 20), model: excerpt(input.modelId ?? input.model, 120), prompt: excerpt(input.prompt, 240) };
  });
}

/**
 * When the workspace asks before generating, a run an agent queues with any generation step waits for
 * a person. Returns the recorder for its approval, or null to queue the run at once.
 */
export function agentRunAdmission(db: DatabaseSync, plan: Plan) {
  const agent = currentAgent();
  if (!agent || readApprovalMode(db) !== 'ask') return null;
  const generating = new Set(runtimeCapabilities().filter((capability) => capability.generation).map((capability) => capability.operation));
  const nodes = plan.nodes.filter((node) => generating.has(node.operation));
  if (!nodes.length) return null;
  const steps = describeGenerationSteps(nodes);
  return (runId: string) => { insertApproval(db, { projectId: plan.projectId, kind: 'run', runId, channel: agent.channel, tool: agent.tool, steps }); };
}
