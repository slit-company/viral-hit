import { m as uiMessages } from '@/paraglide/messages.js';
import { useStudioTools } from './use-studio-tools';
import { StudioToolNavigation, StudioToolSelection } from './studio-tool-navigation';
import { StudioToolComposer } from './studio-tool-composer';
import { StudioToolGuide } from './studio-tool-guide';
import { defaultStudioTool, STUDIO_TOOL_KINDS } from '@/core/studio/tools';
import { Action } from '@/components/base/action';
import { Link } from '@/core/i18n/navigation';
import { useStudioVisualSources } from './use-studio-visual-sources';
import { useStudioContinue } from './use-studio-continue';
import { visualSourceReferences } from '@/core/studio/studio-visual-sources';
import { StudioAudioComposer } from './studio-audio-composer';
import { useStudioAudio } from './use-studio-audio';
import { StudioAnalysisComposer } from './studio-analysis-composer';
import { useStudioAnalysis } from './use-studio-analysis';
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { StudioGenerationFeed } from '@/components/studio/studio-generation-feed';
import type { CanvasCardMediaType } from '@/core/creative-canvas/canvas-types';
import { resolveWmTaskId } from '@/core/effects/client-api';
import { resolveOutputMedia } from '@/core/effects/output-media';
import {
  getGenerationPromptConstraints,
  getGenerationPromptMaxChars,
} from '@/core/effects/validation';
import {
  resolveVideoAnalysisText,
} from '@/core/effects/video-analysis';
import {
  findWorkspaceModelOption,
  getDefaultSelectableWorkspaceModel,
} from '@/core/effects/workspace-models';
import {
  applyStudioDraftModel,
  applyStudioHistoryItem,
  createStudioDraftCard,
} from '@/core/studio/studio-draft';
import type { StudioMedia } from '@/core/studio/studio-runtime';
import {
  fetchProjectGenerations,
} from '@/core/workspace-lib/app/workspace-client-api';
import { GENERATION_REQUEST_VERSION } from '@/core/commands/generation-contract';
import { precheckEffect, generateEffect } from '@/core/effects/client-api';
import { getEffectsMetadata } from '@/core/effects/client-api';
import { buildDraftModelParameters } from '@/core/effects/model-parameters';
import { invalidateWorkspaceAfterGeneration } from '@/core/workspace-lib/app/workspace-query-invalidation';
import { projectGenerationsKeys } from '@/core/workspace-lib/app/workspace-query-keys';
import { apiJsonGet, apiJsonPost } from '@/lib/api-client';

type GenerationResponse = {
  status?: 'pending' | 'processing' | 'succeeded' | 'failed';
  wmTaskId?: string;
  output?: unknown;
  error?: string;
  uploadIntentToken?: string;
};

const wait = (ms: number) =>
  new Promise((resolve) => window.setTimeout(resolve, ms));

async function waitForGeneration({
  wmTaskId,
}: {
  wmTaskId: string;
}) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (document.visibilityState === 'hidden') {
      await wait(2500);
      attempt -= 1;
      continue;
    }
    const result = await apiJsonGet<GenerationResponse>(
      `/api/effects/status?wmTaskId=${encodeURIComponent(wmTaskId)}`
    );
    if (result.status === 'succeeded') return result.output;
    if (result.status === 'failed') {
      throw new Error(result.error || uiMessages["ui.studio.generation_failed"]());
    }
    await wait(2500);
  }
  throw new Error(
    uiMessages["ui.studio.generation_is_still_processing_you_can_find_it_in_history"]()
  );
}

export function StudioWorkspace({
  projectId,
  initialTarget,
  initialModelId,
  initialPrompt,
}: {
  projectId: string;
  initialTarget: string | null;
  initialModelId: string | null;
  initialPrompt: string | null;
}) {
  const queryClient = useQueryClient();
  const initialMedia: StudioMedia =
    initialTarget === 'analysis'
      ? 'analysis'
      : initialTarget === 'audio' ? 'audio'
      : initialTarget === 'video'
        ? 'video'
        : 'image';
  const tools = useStudioTools(projectId, initialTarget, initialModelId);
  const imageModels = tools.models.filter(model => model.workspaceType === 'ai-image');
  const videoModels = tools.models.filter(model => model.workspaceType === 'ai-video');
  const [resultView, setResultView] = useState<'history' | 'guide'>('history');
  const [draft, setDraft] = useState(() => {
    const draftMedia = initialMedia === 'video' ? 'video' : 'image';
    const models = draftMedia === 'video' ? videoModels : imageModels;
    const model =
      findWorkspaceModelOption(models, initialModelId) ??
      getDefaultSelectableWorkspaceModel(
        draftMedia === 'video' ? 'ai-video' : 'ai-image'
      );
    return createStudioDraftCard({
      type: draftMedia,
      model,
      prompt: initialPrompt || '',
    });
  });
  const [media, setMedia] = useState<StudioMedia>(initialMedia);
  const [error, setError] = useState('');
  // A prompt from the home box belongs to the tool it was written for, not to every composer.
  const analysis = useStudioAnalysis({ projectId, initialModelId: initialMedia === 'analysis' ? initialModelId ?? undefined : undefined, initialPrompt: initialMedia === 'analysis' ? initialPrompt ?? undefined : undefined, onError: setError });
  const audio = useStudioAudio({ projectId, initialModelId: initialMedia === 'audio' ? initialModelId ?? undefined : undefined, initialPrompt: initialMedia === 'audio' ? initialPrompt ?? undefined : undefined, onError: setError });
  const selectedModel = tools.model && ['ai-image', 'ai-video'].includes(tools.model.workspaceType) ? tools.model : null;
  const visualSources = useStudioVisualSources(projectId, selectedModel, setError);
  const continueWith = useStudioContinue({ projectId, tools, sources: visualSources, onReady: () => setDraft(current => ({ ...current, prompt: '' })), onError: setError });

  const generationsQuery = useQuery({
    queryKey: projectGenerationsKeys.list(projectId),
    queryFn: () => fetchProjectGenerations(projectId),
    refetchInterval: (query) =>
      query.state.data?.items.some(
        (item) => item.status === 'pending' || item.status === 'processing'
      )
        ? 2500
        : false,
  });
  const feedItems = generationsQuery.data?.items ?? [];

  useEffect(() => {
    if (!tools.ready) return;
    const kind = STUDIO_TOOL_KINDS[tools.tool];
    setMedia(kind);
    if (!tools.model) return;
    if (kind === 'audio') { if (audio.draft.modelId !== tools.model.id) audio.update({ modelId: tools.model.id }); }
    else if (kind === 'analysis') { if (analysis.draft.modelId !== tools.model.id) analysis.update({ modelId: tools.model.id }); }
    else if (draft.modelId !== tools.model.id || draft.type !== kind) setDraft(current => applyStudioDraftModel({ draft: { ...current, type: kind }, model: tools.model! }));
  }, [tools.ready, tools.tool, tools.model?.id, audio.draft.modelId, analysis.draft.modelId, draft.modelId, draft.type]);

  const generation = useMutation({
    mutationFn: async () => {
      if (!tools.model || tools.model.available === false) throw Error(uiMessages["studio.tools.connect_the_selected_model_s_api_first"]());
      if (visualSources.busy) throw Error('Wait for source files to finish loading.');
      const isAnalysis = media === 'analysis';
      if (!isAnalysis && media !== 'audio' && !selectedModel) {
        throw new Error(uiMessages["ui.studio.no_model_is_available_for_this_media_type"]());
      }
      let request;
      if (isAnalysis) request = analysis.request();
      else if (media === 'audio') request = audio.request();
      else {
        const promptConstraints = getGenerationPromptConstraints({ modelId: selectedModel?.id });
        if (promptConstraints.required && !draft.prompt.trim()) throw new Error(uiMessages["ui.studio.describe_what_you_want_to_create_first"]());
        const initialInput = buildDraftModelParameters(draft, (await getEffectsMetadata([selectedModel!.id])).data.effects?.[selectedModel!.id]?.inputSchema);
        const references = visualSourceReferences(visualSources.sources, selectedModel, visualSources.mask);
        request = { version: GENERATION_REQUEST_VERSION, projectId, mode: draft.type, modelId: selectedModel!.id, prompt: draft.prompt, references, parameters: initialInput };
      }
      const precheck = await precheckEffect({ generation: request });
      if (!precheck.ok) throw new Error(precheck.data.error || uiMessages["ui.studio.generation_validation_failed"]());
      const response = await generateEffect({
        generation: request, generationIntentToken: precheck.data.uploadIntentToken,
      });
      if (!response.ok) throw new Error(response.data.error || uiMessages["ui.studio.generation_failed_2"]());
      const created = response.data;
      if (created.status === 'failed') {
        throw new Error(created.error || uiMessages["ui.studio.generation_failed"]());
      }
      await invalidateWorkspaceAfterGeneration(queryClient);
      const wmTaskId = resolveWmTaskId(created);
      let output = created.output;
      if (wmTaskId && created.status !== 'succeeded') {
        output = await waitForGeneration({
          wmTaskId,
        });
      }
      if (isAnalysis) {
        if (!resolveVideoAnalysisText(output)) {
          throw new Error(uiMessages["ui.studio.analysis_completed_without_text_output"]());
        }
      } else if (!resolveOutputMedia(output).resultUrl) {
        throw new Error(uiMessages["ui.studio.generation_completed_without_a_media_url"]());
      }
    },
    onSuccess: () => {
      setError('');
      void invalidateWorkspaceAfterGeneration(queryClient);
    },
    onError: (generationError: Error) => {
      setError(generationError.message);
      void invalidateWorkspaceAfterGeneration(queryClient);
    },
  });

  const busy = !tools.ready || generation.isPending || analysis.busy || audio.busy || visualSources.busy;
  function changeMedia(next: StudioMedia) { if (!busy) tools.selectTool(defaultStudioTool(next)); }
  function reuse(item: (typeof feedItems)[number]) {
    if (busy) return;
    if (item.modelId) tools.selectModel(item.modelId);
    if (item.mediaType === 'audio') { void audio.reuse(item); return; }
    if (item.mediaType === 'analysis') { void analysis.reuse(item); return; }
    const next = applyStudioHistoryItem({ item, imageModels, videoModels });
    setDraft(next.draft);
    void visualSources.reuse(item);
  }
  function setPrompt(prompt: string) {
    if (busy) return;
    if (media === 'audio') audio.update({ prompt });
    else if (media === 'analysis') analysis.update({ prompt });
    else setDraft(current => ({ ...current, prompt }));
  }
  const start = () => { setError(''); setResultView('history'); generation.mutate(); };
  return <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[var(--vh-bg)] text-[var(--vh-text-1)]">
    <StudioToolNavigation tools={tools} disabled={busy} />
    <div className="grid min-h-0 flex-1 overflow-y-auto lg:grid-cols-[380px_minmax(0,1fr)] lg:overflow-hidden xl:grid-cols-[400px_minmax(0,1fr)]">
      <aside aria-label={uiMessages["studio.tools.creation_settings"]()} className="min-w-0 space-y-5 border-b border-[var(--vh-border)] bg-[var(--vh-surface)] p-5 lg:overflow-y-auto lg:border-b-0 lg:border-r">
        <StudioToolSelection tools={tools} disabled={busy} />
        {(tools.model || tools.missingModelId) && (media === 'audio' ? <StudioAudioComposer panel projectId={projectId} audio={audio} isBusy={generation.isPending || Boolean(tools.model && tools.model.id !== audio.draft.modelId)} onMediaChange={changeMedia} onGenerate={start} />
          : media === 'analysis' ? <StudioAnalysisComposer panel projectId={projectId} analysis={analysis} isBusy={generation.isPending || Boolean(tools.model && tools.model.id !== analysis.draft.modelId)} onMediaChange={changeMedia} onGenerate={start} />
          : selectedModel && <StudioToolComposer projectId={projectId} tool={tools.tool} draft={draft} model={selectedModel} sources={visualSources} busy={busy} onChange={next => { if (!busy) setDraft(next); }} onGenerate={start} />)}
        {error && <p role="alert" className="break-words rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      </aside>
      <section aria-label={uiMessages["studio.tools.project_results"]()} className="min-w-0 bg-[var(--vh-bg)] lg:overflow-y-auto">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--vh-border)] px-5 py-3">
          <div role="group" aria-label={uiMessages["studio.tools.result_view"]()} className="flex gap-1 rounded-full bg-[var(--vh-control)] p-1">{(['history', 'guide'] as const).map(view => <Action key={view} aria-pressed={resultView === view} onClick={() => setResultView(view)} className={'rounded-full px-4 py-2 text-xs ' + (resultView === view ? 'bg-[var(--vh-surface)] font-semibold shadow-sm' : 'text-[var(--vh-text-2)]')}>{view === 'history' ? uiMessages["studio.tools.results"]() + (feedItems.length ? ' · ' + feedItems.length : '') : uiMessages["studio.tools.how_it_works"]()}</Action>)}</div>
          <Link href={'/editor/' + projectId} className="text-xs font-semibold underline-offset-4 hover:underline">{uiMessages["studio.tools.open_editor_link"]()}</Link>
        </header>
        <div className="p-4 sm:p-6">
          {generationsQuery.isError && <p role="alert" className="mb-4 text-sm text-red-700">{uiMessages["studio.tools.could_not_load_your_generation_history"]()}<Action className="underline" onClick={() => void generationsQuery.refetch()}>{uiMessages["studio.tools.try_again"]()}</Action></p>}
          {resultView === 'history' && feedItems.length > 0 ? <StudioGenerationFeed projectId={projectId} items={feedItems} onReuse={reuse} onContinue={(item, tool) => { if (!busy) void continueWith(item, tool); }} /> : <StudioToolGuide tool={tools.tool} projectId={projectId} onPrompt={setPrompt} disabled={busy} />}
        </div>
      </section>
    </div>
  </section>;
}
