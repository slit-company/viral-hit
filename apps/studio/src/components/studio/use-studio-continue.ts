import type { ProjectGenerationItem } from '@/core/effects/project-generations';
import type { StudioToolId } from '@/core/studio/tools';
import { m as uiMessages } from '@/paraglide/messages.js';
import { loadStudioSources } from './use-studio-source-actions';
import type { StudioToolsController } from './use-studio-tools';
import type { StudioVisualSourcesController } from './use-studio-visual-sources';

/** Next steps offered on a finished result, in the order people usually take them. */
export function continueTools(item: Pick<ProjectGenerationItem, 'mediaType' | 'status' | 'resultUrl'>): StudioToolId[] {
  if (item.status !== 'succeeded' || !item.resultUrl) return [];
  if (item.mediaType === 'image') return ['image-edit', 'video-generate'];
  if (item.mediaType === 'video') return ['video-edit'];
  return [];
}

/** Opens a tool with a finished result already attached as its source. */
export function useStudioContinue({ projectId, tools, sources, onReady, onError }: {
  projectId: string;
  tools: StudioToolsController;
  sources: StudioVisualSourcesController;
  onReady: () => void;
  onError: (message: string) => void;
}) {
  return async function continueWith(item: ProjectGenerationItem, tool: StudioToolId) {
    if (!continueTools(item).includes(tool)) return;
    try {
      const library = await loadStudioSources(projectId);
      const source = library.sources.find(candidate => candidate.publicUrl === item.resultUrl);
      if (!source) throw Error(uiMessages["studio.tools.could_not_find_the_project_file_for_this_result_check_your_project_media"]());
      tools.selectTool(tool, { needs: source.type });
      sources.replace([source]);
      onError('');
      onReady();
    } catch (failure) {
      onError(failure instanceof Error ? failure.message : uiMessages["studio.tools.could_not_find_the_project_file_for_this_result_check_your_project_media"]());
    }
  };
}
