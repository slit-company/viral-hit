import { AsyncLocalStorage } from 'node:async_hooks';

/** How an AI agent reached Viral Hit, and the tool or command it used. */
export type AgentRequest = { channel: 'mcp' | 'cli'; tool: string };
const current = new AsyncLocalStorage<AgentRequest>();

/** Runs `work` on behalf of an agent, so generation it starts follows the ask-before-generating setting. */
export const runAsAgent = <T>(request: AgentRequest, work: () => T): T => current.run(request, work);
/** The agent behind the current call, or null for work a person started in Viral Hit. */
export const currentAgent = (): AgentRequest | null => current.getStore() ?? null;
