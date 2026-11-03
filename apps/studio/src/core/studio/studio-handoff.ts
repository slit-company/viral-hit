import type { StudioMediaSource } from './studio-media-sources';
import { STUDIO_TOOL_IDS, type StudioToolId } from './tools';

/** Where Studio keeps a project's selected sources and its chosen tool for the browser tab. */
export const studioSourcesKey = (projectId: string) => 'viral-hit:studio-visual-sources:' + projectId;
export const studioToolsKey = (projectId: string, target?: string | null, modelId?: string | null) => 'viral-hit:studio-tools:' + projectId + ':' + (target ?? '') + ':' + (modelId ?? '');

/** Opens Studio on a tool, with these project files selected when given, as when a layer is sent to be edited. */
export function handOffToStudio(projectId: string, tool: StudioToolId, sources?: StudioMediaSource[]) {
  if (sources) sessionStorage.setItem(studioSourcesKey(projectId), JSON.stringify({ sources }));
  sessionStorage.setItem(studioToolsKey(projectId), JSON.stringify({ tool }));
}

export const isStudioTool = (value: unknown): value is StudioToolId => typeof value === 'string' && (STUDIO_TOOL_IDS as readonly string[]).includes(value);
