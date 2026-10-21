import { StudioAnalysisComposer } from './studio-analysis-composer';
import { useStudioAnalysis } from './use-studio-analysis';
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { StudioComposer } from '@/components/studio/studio-composer';
import { StudioGenerationFeed } from '@/components/studio/studio-generation-feed';
import { StudioStartHere } from '@/components/studio/studio-start-here';
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
import { parseLocalProjectAssetUrl } from '@/core/projects/local-project-asset-url';
import { GENERATION_REQUEST_VERSION } from '@/core/commands/generation-contract';
import { precheckEffect, generateEffect } from '@/core/effects/client-api';
import { fetchRecentAssets } from '@/core/workspace-lib/app/workspace-client-api';
import { getEffectsMetadata } from '@/core/effects/client-api';
import { buildDraftModelParameters } from '@/core/effects/model-parameters';
import { invalidateWorkspaceAfterGeneration } from '@/core/workspace-lib/app/workspace-query-invalidation';
import { projectGenerationsKeys } from '@/core/workspace-lib/app/workspace-query-keys';
import { apiJsonGet, apiJsonPost } from '@/lib/api-client';
import { useAvailableModels } from '@/core/workspace-hooks/use-available-models';

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
      throw new Error(result.error || 'Generation failed');
    }
    await wait(2500);
  }
  throw new Error(
    'Generation is still processing. You can find it in History.'
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
      : initialTarget === 'video'
        ? 'video'
        : 'image';
  const { imageModels, videoModels } = useAvailableModels();
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
  const [referenceUrls, setReferenceUrls] = useState<string[]>([]);
  const [error, setError] = useState('');
  const analysis = useStudioAnalysis({ projectId, initialModelId: initialMedia === 'analysis' ? initialModelId ?? undefined : undefined, initialPrompt: initialPrompt ?? undefined, onError: setError });
  const models = draft.type === 'video' ? videoModels : imageModels;
  const selectedModel =
    findWorkspaceModelOption(models, draft.modelId) ?? models[0] ?? null;

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
  const feedItems = (generationsQuery.data?.items ?? []).filter(
    (item) => item.status !== 'failed'
  );

  useEffect(() => {
    if (!selectedModel || selectedModel.id === draft.modelId) return;
    setDraft((current) =>
      applyStudioDraftModel({ draft: current, model: selectedModel })
    );
  }, [draft.modelId, selectedModel]);

  const generation = useMutation({
    mutationFn: async () => {
      const isAnalysis = media === 'analysis';
      if (!isAnalysis && !selectedModel) {
        throw new Error('No model is available for this media type.');
      }
      let request;
      if (isAnalysis) request = analysis.request();
      else {
        const promptConstraints = getGenerationPromptConstraints({ modelId: selectedModel?.id });
        if (promptConstraints.required && !draft.prompt.trim()) throw new Error('Describe what you want to create first.');
        if (selectedModel?.requiresImageInput && referenceUrls.length === 0) throw new Error(`${selectedModel.name} requires at least one image.`);
        const initialInput = buildDraftModelParameters(draft, (await getEffectsMetadata([selectedModel!.id])).data.effects?.[selectedModel!.id]?.inputSchema);
        const assets = referenceUrls.length ? await fetchRecentAssets(projectId) : null;
        const references = referenceUrls.map((url) => {
          const local = parseLocalProjectAssetUrl(url);
          const asset = [...(assets?.images ?? []), ...(assets?.videos ?? []), ...(assets?.audios ?? [])]
            .find((item) => item.publicUrl === url ||
              (item.metadata as { providerUrl?: string } | null)?.providerUrl === url);
          const assetId = local?.assetId ?? asset?.id;
          if (!assetId) throw new Error('Reference media must belong to this project. Import it again.');
          return { assetId, role: 'reference' as const };
        });
        request = { version: GENERATION_REQUEST_VERSION, projectId, mode: draft.type, modelId: selectedModel!.id, prompt: draft.prompt, references, parameters: initialInput };
      }
      const precheck = await precheckEffect({ generation: request });
      if (!precheck.ok) throw new Error(precheck.data.error || 'Generation validation failed.');
      const response = await generateEffect({
        generation: request, generationIntentToken: precheck.data.uploadIntentToken,
      });
      if (!response.ok) throw new Error(response.data.error || 'Generation failed.');
      const created = response.data;
      if (created.status === 'failed') {
        throw new Error(created.error || 'Generation failed');
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
          throw new Error('Analysis completed without text output.');
        }
      } else if (!resolveOutputMedia(output).resultUrl) {
        throw new Error('Generation completed without a media URL.');
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

  function changeMedia(nextMedia: StudioMedia) {
    if (generation.isPending || analysis.busy) return;
    setMedia(nextMedia);
    setReferenceUrls([]);
    if (nextMedia === 'analysis') return;
    const nextType = nextMedia === 'video' ? 'video' : 'image';
    const nextModels = nextType === 'video' ? videoModels : imageModels;
    const nextModel = nextModels[0] ?? null;
    if (nextModel) {
      setDraft((current) =>
        applyStudioDraftModel({
          draft: { ...current, type: nextType },
          model: nextModel,
        })
      );
    }
  }

  return (
    <section className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-[var(--vh-bg)] text-[var(--vh-text-1)]">
      <div className="pointer-events-none absolute inset-0 bg-[var(--vh-surface)]" />
      <div className="pointer-events-none absolute inset-x-[8%] top-0 h-[62%] opacity-25 [background-image:radial-gradient(rgba(255,255,255,0.16)_0.75px,transparent_0.75px)] [background-size:18px_18px] [mask-image:linear-gradient(to_bottom,black,transparent)]" />

      <div className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-[220px] pt-8 sm:px-6 sm:pb-[210px]">
        {feedItems.length > 0 ? (
          <div className="flex min-h-full w-full flex-col justify-end">
            <StudioGenerationFeed
              items={feedItems}
              onReuse={(item) => {
                if (generation.isPending || analysis.busy) return;
                if (item.mediaType === 'analysis') { setMedia('analysis'); void analysis.reuse(item); return; }
                const next = applyStudioHistoryItem({
                  item,
                  imageModels,
                  videoModels,
                });
                setMedia(next.media);
                setDraft(next.draft);
                setReferenceUrls(next.referenceUrls);
              }}
            />
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <StudioStartHere />
          </div>
        )}
      </div>

      {media === 'analysis' ? <StudioAnalysisComposer projectId={projectId} analysis={analysis} isBusy={generation.isPending} onMediaChange={changeMedia} onGenerate={() => { setError(''); generation.mutate(); }} /> : <StudioComposer
        draft={draft}
        media={media}
        imageModels={imageModels}
        videoModels={videoModels}
        isBusy={generation.isPending}
        promptCharacterLimit={
          getGenerationPromptMaxChars({ modelId: selectedModel?.id })
        }
        takeCount={feedItems.length}
        onDraftChange={(next) => {
          if (next.type !== draft.type || next.modelId !== draft.modelId) {
            const nextModels =
              next.type === 'video' ? videoModels : imageModels;
            const nextModel =
              findWorkspaceModelOption(nextModels, next.modelId) ??
              nextModels[0] ??
              null;
            if (nextModel) {
              setDraft(
                applyStudioDraftModel({
                  draft: { ...next, type: next.type as CanvasCardMediaType },
                  model: nextModel,
                })
              );
              return;
            }
          }
          setDraft(next);
        }}
        onMediaChange={changeMedia}
        referenceUrls={referenceUrls}
        onRemoveReference={(url) =>
          setReferenceUrls((current) =>
            current.filter((item) => item !== url)
          )
        }
        onGenerate={() => {
          setError('');
          generation.mutate();
        }}
      />}

      {error ? (
        <p role="alert" className="absolute inset-x-3 top-3 z-30 rounded-xl border border-red-200 bg-white p-3 text-sm text-red-800">
          {error}
        </p>
      ) : null}
    </section>
  );
}
