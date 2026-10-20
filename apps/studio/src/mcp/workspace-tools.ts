import type { McpServer } from '@modelcontextprotocol/server';
import { registerPublishingTools } from './publishing-tools';
import { registerProjectBundleTools } from './project-bundle-tools';
/** Registration seam for project transfer and delivery tools. */
export function registerWorkspaceTools(server: McpServer, project: (projectId?: string) => Promise<{ id: string }>) {
  registerPublishingTools(server, project);
  registerProjectBundleTools(server);
}
