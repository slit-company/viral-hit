import { useEffect, useState, useRef } from 'react';
import { useWorkspaceModels } from '@/core/workspace-hooks/use-workspace-metadata';
import {
  chooseToolModel,
  defaultStudioTool,
  modelStudioTools,
  toolModels,
  type StudioToolId,
} from '@/core/studio/tools';

export function useStudioTools(
  projectId: string,
  initialTarget: string | null,
  initialModelId: string | null,
) {
  const catalog = useWorkspaceModels();
  const choices = useRef(new Map<StudioToolId, string>());
  const storageKey = `viral-hit:studio-tools:${projectId}:${initialTarget ?? ''}:${initialModelId ?? ''}`;
  const [tool, setTool] = useState<StudioToolId>(
    defaultStudioTool(initialTarget ?? 'image'),
  );
  const [modelId, setModelId] = useState(initialModelId ?? '');
  const [initialized, setInitialized] = useState(false);
  const models = catalog.data?.models ?? [];
  const candidates = toolModels(models, tool);
  const model = candidates.find((item) => item.id === modelId) ?? null;
  useEffect(() => {
    if (!catalog.data || initialized) return;
    let saved: { tool?: StudioToolId; modelId?: string } = {};
    try {
      saved = JSON.parse(sessionStorage.getItem(storageKey) ?? '{}');
    } catch {
      /* Optional selection cache; never replace the source drafts. */
    }
    const initial =
      models.find((item) => item.id === saved?.modelId) ??
      models.find((item) => item.id === initialModelId);
    const nextTool = initial
      ? saved?.tool && modelStudioTools(initial).includes(saved.tool)
        ? saved.tool
        : modelStudioTools(initial)[0]
      : tool;
    setTool(nextTool);
    const desiredId = saved?.modelId || initialModelId;
    setModelId(
      desiredId && !models.some((item) => item.id === desiredId)
        ? desiredId
        : (chooseToolModel(toolModels(models, nextTool), undefined, initial?.id)
            ?.id ?? ''),
    );
    setInitialized(true);
  }, [catalog.data, initialized]);
  useEffect(() => {
    if (!initialized || !catalog.data || modelId !== '') return;
    setModelId(chooseToolModel(candidates)?.id ?? '');
  }, [catalog.data, initialized, tool, modelId]);
  useEffect(() => {
    if (!initialized || !model) return;
    choices.current.delete(tool);
    choices.current.set(tool, model.id);
    try {
      sessionStorage.setItem(
        storageKey,
        JSON.stringify({ tool, modelId: model.id }),
      );
    } catch {
      /* Session storage can be unavailable. */
    }
  }, [initialized, storageKey, tool, modelId]);
  /** `needs` prefers a model that accepts that kind of source, so a handed-over result is used. */
  function selectTool(next: StudioToolId, options: { needs?: 'image' | 'video' | 'audio' } = {}) {
    setTool(next);
    const cached = models.find((item) => item.id === choices.current.get(next));
    const all = toolModels(models, next);
    const accepting = options.needs ? all.filter((item) => (item.referenceInputs?.[options.needs!]?.max ?? 0) > 0) : [];
    setModelId(
      chooseToolModel(
        accepting.length ? accepting : all,
        cached?.providerId ?? model?.providerId,
        cached?.id,
      )?.id ?? '',
    );
  }
  function selectModel(id: string) {
    const next = models.find((item) => item.id === id);
    if (!next) return;
    if (!modelStudioTools(next).includes(tool))
      setTool(modelStudioTools(next)[0]);
    setModelId(id);
  }
  return {
    ready: initialized,
    missingModelId: modelId && !model ? modelId : null,
    tool,
    model,
    candidates,
    models,
    loading: catalog.isPending,
    error: catalog.isError,
    refresh: () => catalog.refetch(),
    selectTool,
    selectGroup: (group: StudioToolId[]) =>
      selectTool(
        [...choices.current.keys()]
          .reverse()
          .find((task) => group.includes(task)) ?? group[0],
      ),
    selectModel,
    selectProvider: (id: string) =>
      setModelId(chooseToolModel(candidates, id)?.id ?? ''),
  };
}
export type StudioToolsController = ReturnType<typeof useStudioTools>;
