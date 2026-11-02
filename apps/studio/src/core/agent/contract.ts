import { z } from 'zod';

/** Whether generation an AI agent asks for waits for a person ("ask") or starts at once ("off"). */
export const APPROVAL_MODES = ['off', 'ask'] as const;
export type ApprovalMode = (typeof APPROVAL_MODES)[number];
export type ApprovalState = 'pending' | 'approved' | 'rejected' | 'used';
/** One generation step as the person approving it sees it; mode is image, video, audio or analysis when known. */
export type ApprovalStep = { label: string; mode?: string; model?: string; prompt?: string };
export type ApprovalView = {
  id: string; projectId: string; projectName: string | null;
  /** run: a queued run waits; request: the agent repeats its call after approval. */
  kind: 'run' | 'request'; runId: string | null;
  channel: 'mcp' | 'cli'; tool: string; steps: ApprovalStep[];
  state: ApprovalState; createdAt: string; decidedAt: string | null;
};
export type MemoryEntry = {
  id: string; projectId: string | null; projectName: string | null;
  text: string; source: 'person' | 'agent'; createdAt: string; updatedAt: string;
};
export type AgentOverview = { mode: ApprovalMode; pending: ApprovalView[]; recent: ApprovalView[]; memory: MemoryEntry[] };

export const MEMORY_TEXT_LIMIT = 600;
export const MEMORY_SCOPE_LIMIT = 200;
const id = z.string().trim().min(1).max(128);
export const memoryText = z.string().trim().min(1).max(MEMORY_TEXT_LIMIT);
export const agentAction = z.discriminatedUnion('action', [
  z.object({ action: z.literal('set_mode'), mode: z.enum(APPROVAL_MODES) }).strict(),
  z.object({ action: z.literal('decide'), id, decision: z.enum(['approve', 'reject']) }).strict(),
  z.object({ action: z.literal('remember'), text: memoryText, projectId: id.nullable().default(null), id: id.optional() }).strict(),
  z.object({ action: z.literal('forget'), id }).strict(),
]);
export type AgentAction = z.infer<typeof agentAction>;
