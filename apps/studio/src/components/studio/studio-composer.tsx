import { StudioReferenceThumbnails } from './studio-reference-thumbnails';
import { ModelOptions } from '@/components/generation-providers/model-options';
import { Action } from '@/components/base/action';
import {
  ArrowUp,
  Film,
  ImageIcon,
  ImagePlus,
  Loader2,
  ScanSearch,
  Sparkles,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import {
  composerCardClassName,
  composerGenerateButtonClassName,
} from '@/components/app/composer-styles';
import { WorkspaceSelect } from '@/components/app/workspace-select';
import { CreativeCanvasComposerParameterPicker } from '@/components/creative-canvas/creative-canvas-composer-parameter-picker';
import { normalizeComposerToken } from '@/components/creative-canvas/creative-canvas-composer-utils';
import { useCanvasComposerLabels } from '@/components/creative-canvas/use-canvas-composer-labels';
import type { CanvasGenerationCard } from '@/core/creative-canvas/canvas-types';
import {
  countPromptCharacters,
  getGenerationPromptConstraints,
  truncatePromptToMaxChars,
} from '@/core/effects/validation';
import {
  findWorkspaceModelOption,
  getWorkspaceAspectRatioOptions,
  type WorkspaceModelOption,
} from '@/core/effects/workspace-models';
import { getModelIconPathByModelId } from '@/core/workspace-lib/model-icons';
import type { StudioMedia } from '@/core/studio/studio-runtime';
import { useTranslations } from '@/core/workspace-lib/shims/next-intl';
import { cn } from '@/lib/utils';

export function StudioComposer({
  draft,
  media,
  imageModels,
  videoModels,
  isBusy,
  promptCharacterLimit,
  takeCount: _takeCount = 0,
  onDraftChange,
  onMediaChange,
  onGenerate,
  referenceUrls = [],
  onRemoveReference,
}: {
  draft: CanvasGenerationCard;
  media: 'image' | 'video';
  imageModels: WorkspaceModelOption[];
  videoModels: WorkspaceModelOption[];
  isBusy: boolean;
  promptCharacterLimit: number;
  takeCount?: number;
  onDraftChange: (next: CanvasGenerationCard) => void;
  onMediaChange: (next: StudioMedia) => void;
  onGenerate: () => void;
  referenceUrls?: string[];
  onRemoveReference?: (url: string) => void;
}) {
  const labels = useCanvasComposerLabels();
  const t = useTranslations('AppShell.studio.analysis');
  const parameterPickerRef = useRef<HTMLDivElement | null>(null);
  const [isParameterOpen, setIsParameterOpen] = useState(false);
  const models = media === 'video' ? videoModels : imageModels;
  const selectedModel =
    findWorkspaceModelOption(models, draft.modelId) ?? models[0] ?? null;
  const promptRequired = getGenerationPromptConstraints({
    modelId: selectedModel?.id,
  }).required;
  const selectedModeOptions = selectedModel?.modeOptions ?? [];
  const selectedVariantOptions = selectedModel?.variantOptions ?? [];
  const selectedQualityOptions = selectedModel?.qualityOptions ?? [];
  const selectedDurationOptions =
    media === 'video' ? (selectedModel?.supportedDurations ?? []) : [];
  const selectedLanguageOptions = selectedModel?.supportedLanguages ?? [];
  const selectedAspectRatioOptions = useMemo(
    () =>
      getWorkspaceAspectRatioOptions({
        model: selectedModel,
        hasImageReferences: referenceUrls.length > 0,
      }),
    [referenceUrls.length, selectedModel]
  );
  const selectedOutputQualities = selectedModel?.supportedOutputQualities ?? [];
  const selectedCharacterOrientationOptions =
    selectedModel?.characterOrientationOptions ?? [];
  const selectedBackgroundSourceOptions =
    selectedModel?.backgroundSourceOptions ?? [];
  const visibleParameterSummaryTokens = [
    ...(selectedOutputQualities.length > 0
      ? [draft.outputQuality.toUpperCase()]
      : []),
    ...(selectedAspectRatioOptions.length > 0
      ? [normalizeComposerToken(draft.aspectRatio, labels)]
      : []),
    ...(selectedDurationOptions.length > 0 ? [draft.duration] : []),
    ...(selectedModeOptions.length > 1
      ? [normalizeComposerToken(draft.mode, labels)]
      : []),
    ...(selectedVariantOptions.length > 1
      ? [normalizeComposerToken(draft.variant, labels)]
      : []),
    ...(selectedQualityOptions.length > 1
      ? [normalizeComposerToken(draft.quality, labels)]
      : []),
  ];
  const promptCharacterCount = countPromptCharacters(draft.prompt);
  const primaryButtonLabel = isBusy ? labels.generatingLabel : labels.generateLabel;

  useEffect(() => {
    if (
      selectedAspectRatioOptions.length === 0 ||
      selectedAspectRatioOptions.includes(draft.aspectRatio)
    ) {
      return;
    }
    onDraftChange({
      ...draft,
      aspectRatio:
        selectedModel?.defaultAspectRatio ?? selectedAspectRatioOptions[0],
    });
  }, [
    draft,
    onDraftChange,
    selectedAspectRatioOptions,
    selectedModel?.defaultAspectRatio,
  ]);

  return (
    <div className="absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-[var(--vh-bg)] via-[var(--vh-bg)]/96 to-transparent px-3 pb-3 pt-12 sm:px-6 sm:pb-5 sm:pt-14">
      <div
        className={cn(
          'mx-auto w-full max-w-[1138px] p-2.5 sm:p-3.5',
          composerCardClassName
        )}
        data-vh-composer=""
      >
        <StudioReferenceThumbnails urls={referenceUrls} onRemove={onRemoveReference} />
        <div className="relative">
          <Action
            type="button"
            aria-label={labels.uploadImageLabel}
            title={t('referenceUploadSoon')}
            className="absolute left-0 top-0 z-10 flex size-9 rotate-[-5deg] items-center justify-center rounded-[10px] border border-dashed border-[var(--vh-border)] bg-[var(--vh-control)] text-[var(--vh-text-2)] shadow-none transition hover:border-[var(--vh-border)] hover:bg-[var(--vh-control)]"
          >
            <ImagePlus className="size-3.5" />
          </Action>
          <textarea
            value={draft.prompt}
            onChange={(event) =>
              onDraftChange({
                ...draft,
                prompt: truncatePromptToMaxChars(
                  event.target.value,
                  promptCharacterLimit
                ),
              })
            }
            placeholder={
              media === 'video'
                ? labels.videoPromptPlaceholder
                : labels.imagePromptPlaceholder
            }
            disabled={isBusy}
            className="h-[80px] min-h-[80px] w-full resize-none bg-transparent py-2 pl-[52px] pr-3 text-[14px] leading-6 text-[var(--vh-text-1)] outline-none placeholder:text-[var(--vh-text-2)] sm:h-[92px] sm:min-h-[92px] sm:pl-[56px] sm:pr-16 sm:text-[15px]"
          />
        </div>

        <div className="mt-1.5 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
            {<ModelOptions modelId={draft.modelId} value={draft.modelOptions} disabled={isBusy} onChange={modelOptions => onDraftChange({ ...draft, modelOptions })} />}
            <WorkspaceSelect
              ariaLabel="Media type"
              triggerClassName="min-w-[96px]"
              value={media}
              options={[
                {
                  value: 'image',
                  label: labels.imageModeLabel,
                  leading: (
                    <ImageIcon className="size-3.5 shrink-0 text-[var(--vh-text-2)]" />
                  ),
                },
                {
                  value: 'video',
                  label: labels.videoModeLabel,
                  leading: (
                    <Film className="size-3.5 shrink-0 text-[var(--vh-text-2)]" />
                  ),
                },
                { value: 'audio', label: 'Audio' },
                {
                  value: 'analysis',
                  label: t('modeLabel'),
                  leading: (
                    <ScanSearch className="size-3.5 shrink-0 text-[var(--vh-text-2)]" />
                  ),
                },
              ]}
              onChange={(type) =>
                onMediaChange(
                  type === 'analysis' ? 'analysis' : type === 'audio' ? 'audio' : type === 'video' ? 'video' : 'image'
                )
              }
            />

            <WorkspaceSelect
              ariaLabel="Model"
              triggerClassName="w-fit max-w-full"
              value={selectedModel?.id || ''}
              options={models.map((model) => ({
                value: model.id,
                label: model.name,
                leading: (
                  <span className="grid size-4 shrink-0 place-items-center rounded-[4px] bg-[var(--vh-control)] ring-1 ring-black/10">
                    <img
                      src={getModelIconPathByModelId(model.id) || '/logo.png'}
                      alt=""
                      className="size-3 rounded-[2px]"
                    />
                  </span>
                ),
              }))}
              onChange={(modelId) => onDraftChange({ ...draft, modelId })}
              leadingIcon={
                <Sparkles className="size-3.5 shrink-0 text-[var(--vh-text-2)]" />
              }
            />

            {visibleParameterSummaryTokens.length > 0 ? (
              <CreativeCanvasComposerParameterPicker
                activeDraftCard={draft}
                containerRef={parameterPickerRef}
                isDraftBusy={isBusy}
                isOpen={isParameterOpen}
                labels={labels}
                onDraftAspectRatioChange={(_draftId, aspectRatio) =>
                  onDraftChange({ ...draft, aspectRatio })
                }
                onDraftBackgroundSourceChange={(_draftId, backgroundSource) =>
                  onDraftChange({ ...draft, backgroundSource })
                }
                onDraftCharacterOrientationChange={(
                  _draftId,
                  characterOrientation
                ) => onDraftChange({ ...draft, characterOrientation })}
                onDraftDurationChange={(_draftId, duration) =>
                  onDraftChange({ ...draft, duration })
                }
                onDraftLanguageChange={(_draftId, language) =>
                  onDraftChange({ ...draft, language })
                }
                onDraftModeChange={(_draftId, mode) =>
                  onDraftChange({ ...draft, mode })
                }
                onDraftOutputQualityChange={(_draftId, outputQuality) =>
                  onDraftChange({ ...draft, outputQuality })
                }
                onDraftQualityChange={(_draftId, quality) =>
                  onDraftChange({ ...draft, quality })
                }
                onDraftVariantChange={(_draftId, variant) =>
                  onDraftChange({ ...draft, variant })
                }
                onOpenChange={setIsParameterOpen}
                parameterSummaryLabel={labels.parameterLabel}
                selectedAspectRatioOptions={selectedAspectRatioOptions}
                selectedBackgroundSourceOptions={
                  selectedBackgroundSourceOptions
                }
                selectedCharacterOrientationOptions={
                  selectedCharacterOrientationOptions
                }
                selectedDurationOptions={selectedDurationOptions}
                selectedLanguageOptions={selectedLanguageOptions}
                selectedModeOptions={selectedModeOptions}
                selectedOutputQualities={selectedOutputQualities}
                selectedQualityOptions={selectedQualityOptions}
                selectedVariantOptions={selectedVariantOptions}
                visibleParameterSummaryTokens={visibleParameterSummaryTokens}
              />
            ) : null}
          </div>

          <div className="flex shrink-0 items-center justify-end gap-2">
            <span
              className={cn(
                'text-[10px] font-medium tabular-nums',
                promptCharacterCount >= promptCharacterLimit
                  ? 'text-[var(--creative-canvas-warning)]'
                  : 'text-[var(--vh-text-3)]'
              )}
            >
              {promptCharacterCount}/{promptCharacterLimit}
            </span>
            <Action
              type="button"
              onClick={onGenerate}
              disabled={
                isBusy ||
                (promptRequired && !draft.prompt.trim()) ||
                (selectedModel?.requiresImageInput && referenceUrls.length === 0) ||
                !selectedModel
              }
              className={cn(
                composerGenerateButtonClassName,
                'active:translate-y-px'
              )}
              aria-label={primaryButtonLabel}
            >
              {isBusy ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <ArrowUp className="size-3.5" />
              )}
            </Action>
          </div>
        </div>
      </div>
    </div>
  );
}
