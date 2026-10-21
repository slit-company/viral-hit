import { registerAssetGenerationTools } from './asset-generation-tools';
import type { McpServer } from '@modelcontextprotocol/server';
import { registerPublishingTools } from './publishing-tools';
import { registerProjectBundleTools } from './project-bundle-tools';
import { registerRecipePackTools } from './recipe-pack-tools';
import { registerCreativePackTools } from './creative-pack-tools';
import { registerExtensionTools } from './extension-tools';
import { registerCommunityTools } from './community-tools';
import { registerCharacterTools } from './character-tools';
import { registerStoryboardTools } from './storyboard-tools';
/** Registration seam for project transfer, recipe pack, character and delivery tools. */
export function registerWorkspaceTools(server: McpServer, project: (projectId?: string) => Promise<{ id: string }>) {
  registerAssetGenerationTools(server);
  registerPublishingTools(server, project);
  registerProjectBundleTools(server);
  registerRecipePackTools(server);
  registerCharacterTools(server);
  registerCreativePackTools(server);
  registerExtensionTools(server);
  registerCommunityTools(server);
  registerStoryboardTools(server, project);
}
