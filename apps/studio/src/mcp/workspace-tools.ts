import type { McpServer } from '@modelcontextprotocol/server';
import { registerPublishingTools } from './publishing-tools';
import { registerProjectBundleTools } from './project-bundle-tools';
import { registerRecipePackTools } from './recipe-pack-tools';
import { registerCharacterTools } from './character-tools';
/** Registration seam for project transfer, recipe pack, character and delivery tools. */
export function registerWorkspaceTools(server: McpServer, project: (projectId?: string) => Promise<{ id: string }>) {
  registerPublishingTools(server, project);
  registerProjectBundleTools(server);
  registerRecipePackTools(server);
  registerCharacterTools(server);
}
