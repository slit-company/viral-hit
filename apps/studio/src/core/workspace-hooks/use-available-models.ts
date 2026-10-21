import { useMemo } from 'react';
import { getWorkspaceModelsByType, mergeWorkspaceModelOptions, type WorkspaceModelOption } from '@/core/effects/workspace-models';
import { useWorkspaceModels } from './use-workspace-metadata';

const pick = (server: Array<WorkspaceModelOption & { workspaceType: string }>, type: 'ai-image' | 'ai-video') =>
  mergeWorkspaceModelOptions(server.filter((model) => model.workspaceType === type), getWorkspaceModelsByType(type))
    .filter((model) => model.available !== false);

/**
 * Built-in models right away, then the server list, which adds models of providers the operator
 * installed. The references keep their identity while the list is unchanged.
 */
export function useAvailableModels() {
  const { data } = useWorkspaceModels();
  return useMemo(() => {
    const server = data?.models ?? [];
    return { imageModels: pick(server, 'ai-image'), videoModels: pick(server, 'ai-video'), analysisModels: server.filter(model => model.workspaceType === 'analysis' && model.available !== false) };
  }, [data]);
}
