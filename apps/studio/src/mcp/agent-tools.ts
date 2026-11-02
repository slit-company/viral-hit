import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { changeAgent, readAgentMemory, readApproval, readApprovalMode, readApprovals } from '@/core/agent/agent.server';
import { memoryText } from '@/core/agent/contract';
import { withToolErrors } from './tool-results';

const id = z.string().trim().min(1).max(128);

export function registerAgentTools(server: McpServer, project: (projectId?: string) => Promise<{ id: string }>) {
  server.registerTool('viral_hit_memory', {
    description: 'Memory a person or agent asked Viral Hit to keep: preferences, brand rules and decisions, for the whole workspace or one project. Read it before creative work (list returns workspace entries plus the project\'s). Save short, lasting facts the person states (save, up to 600 characters; scope workspace or project; pass id to rewrite an entry); forget entries that no longer hold. Never store secrets, keys or personal data the person did not ask you to keep.',
    inputSchema: z.discriminatedUnion('action', [
      z.object({ action: z.literal('list'), projectId: id.optional() }).strict(),
      z.object({ action: z.literal('save'), text: memoryText, scope: z.enum(['workspace', 'project']).default('project'), projectId: id.optional(), id: id.optional() }).strict(),
      z.object({ action: z.literal('forget'), id }).strict(),
    ]),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, withToolErrors(async (input) => {
    if (input.action === 'forget') return changeAgent({ action: 'forget', id: input.id }, 'agent');
    if (input.action === 'list') return { memory: readAgentMemory((await project(input.projectId)).id) };
    const projectId = input.scope === 'workspace' ? null : (await project(input.projectId)).id;
    return changeAgent({ action: 'remember', text: input.text, projectId, ...(input.id ? { id: input.id } : {}) }, 'agent');
  }));

  server.registerTool('viral_hit_approvals', {
    description: 'Whether this workspace asks a person before generation an agent requests (mode ask or off), and the approvals waiting or decided. A generation tool that answers with status 409 and an approvalId is waiting here: tell the person, then call the same tool again with the same arguments once it is approved. A queued run that waits shows held in viral_hit_runs_list and starts by itself after approval. Agents cannot approve or change the mode.',
    inputSchema: z.discriminatedUnion('action', [
      z.object({ action: z.literal('list'), state: z.enum(['pending', 'all']).default('pending') }).strict(),
      z.object({ action: z.literal('get'), id }).strict(),
    ]),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, withToolErrors(async (input) => {
    const mode = readApprovalMode();
    if (input.action === 'list') return { mode, approvals: readApprovals(input.state) };
    const approval = readApproval(input.id);
    if (!approval) throw new Error('Approval not found.');
    return { mode, approval };
  }));
}
