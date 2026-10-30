import { m as uiMessages } from '@/paraglide/messages.js';
import { ArrowUpRight, Loader2 } from 'lucide-react';
import { Action } from '@/components/base/action';
import { Textarea } from '@/components/ui/textarea';
import { NativeSelect } from '@/components/ui/native-select';
import { StudioVisualSourceControls } from './studio-visual-source-controls';
import { StudioReferenceThumbnails } from './studio-reference-thumbnails';
import { StudioInlineOptions } from './studio-inline-options';
import {
  visualSourceReferences,
  visualReferenceInputs,
} from '@/core/studio/studio-visual-sources';
import { getWorkspaceAspectRatioOptions } from '@/core/effects/workspace-models';
import {
  getGenerationPromptConstraints,
  getGenerationPromptMaxChars,
  truncatePromptToMaxChars,
} from '@/core/effects/validation';
import type { WorkspaceModelMetadata } from '@/core/workspace-hooks/use-workspace-metadata';
import type { CanvasGenerationCard } from '@/core/creative-canvas/canvas-types';
import type { StudioVisualSourcesController } from './use-studio-visual-sources';
import { toolCopy } from './tool-catalog';
import type { StudioToolId } from '@/core/studio/tools';

export function StudioToolComposer({
  projectId,
  tool,
  draft,
  model,
  sources,
  busy,
  onChange,
  onGenerate,
}: {
  projectId: string;
  tool: StudioToolId;
  draft: CanvasGenerationCard;
  model: WorkspaceModelMetadata;
  sources: StudioVisualSourcesController;
  busy: boolean;
  onChange: (draft: CanvasGenerationCard) => void;
  onGenerate: () => void;
}) {
  let valid = true;
  try {
    visualSourceReferences(sources.sources, model, sources.mask);
  } catch {
    valid = false;
  }
  const showSources =
    Object.values(visualReferenceInputs(model)).some(
      (limit) => limit.max > 0,
    ) ||
    sources.sources.length > 0 ||
    sources.unreadable;
  const disabled = busy || model.available === false;
  const images = sources.sources
    .filter((item) => item.type === 'image')
    .map((item) => item.publicUrl);
  const ratios = getWorkspaceAspectRatioOptions({
    model,
    hasImageReferences: images.length > 0,
  });
  const limit = getGenerationPromptMaxChars({ modelId: model.id });
  const required = getGenerationPromptConstraints({
    modelId: model.id,
  }).required;
  const fields = [
    { key: 'aspectRatio', label: uiMessages["studio.tools.aspect_ratio"](), values: ratios },
    { key: 'duration', label: uiMessages["studio.tools.video_length"](), values: model.supportedDurations },
    {
      key: 'outputQuality',
      label: uiMessages["studio.tools.resolution"](),
      values: model.supportedOutputQualities,
    },
    { key: 'quality', label: uiMessages["studio.tools.quality"](), values: model.qualityOptions },
    { key: 'mode', label: uiMessages["studio.tools.generation_mode"](), values: model.modeOptions },
    { key: 'variant', label: uiMessages["studio.tools.model_version"](), values: model.variantOptions },
    { key: 'language', label: uiMessages["studio.tools.language"](), values: model.supportedLanguages },
    {
      key: 'characterOrientation',
      label: uiMessages["studio.tools.character_orientation"](),
      values: model.characterOrientationOptions,
    },
    {
      key: 'backgroundSource',
      label: uiMessages["studio.tools.background"](),
      values: model.backgroundSourceOptions,
    },
  ] as const;
  return (
    <div className="space-y-5" data-vh-composer="">
      {showSources && (
        <div className="space-y-3 rounded-2xl border border-dashed border-[var(--vh-border)] p-4">
          <p className="text-xs font-semibold">{uiMessages["studio.tools.references"]()}</p>
          <StudioVisualSourceControls
            projectId={projectId}
            model={model}
            source={sources}
            disabled={disabled}
          />
          <StudioReferenceThumbnails
            urls={images}
            onRemove={(url) => {
              const item = sources.sources.find(
                (source) => source.publicUrl === url,
              );
              if (item && !disabled) sources.remove(item.id);
            }}
          />
          <p className="text-[11px] leading-5 text-[var(--vh-text-3)]">
            {uiMessages["studio.tools.choose_project_media_or_upload_a_file_selected_references_will_be_used_for_this_task"]()}</p>
        </div>
      )}
      <label className="block space-y-2">
        <span className="text-xs font-semibold">{uiMessages["studio.tools.scene_description"]()}</span>
        <Textarea
          aria-label={uiMessages["studio.tools.scene_description"]()}
          placeholder={toolCopy[tool].hint}
          disabled={disabled}
          value={draft.prompt}
          onChange={(event) =>
            onChange({
              ...draft,
              prompt: truncatePromptToMaxChars(event.target.value, limit),
            })
          }
          className="min-h-32 resize-y text-sm leading-6"
        />
        <span className="block text-right text-[10px] text-[var(--vh-text-3)]">
          {draft.prompt.length} / {limit}
        </span>
      </label>
      <div className="grid grid-cols-2 gap-3">
        {fields
          .filter((field) => field.values?.length)
          .map((field) => (
            <label
              key={field.key}
              className="min-w-0 space-y-1.5 text-xs text-[var(--vh-text-2)]"
            >
              <span>{field.label}</span>
              <NativeSelect
                aria-label={field.label}
                disabled={disabled}
                value={String(draft[field.key] ?? '')}
                onChange={(event) =>
                  onChange({ ...draft, [field.key]: event.target.value })
                }
              >
                {field.values?.map((value) => (
                  <option key={value} value={value}>
                    {value === 'auto' ? uiMessages["studio.tools.match_source"]() : value}
                  </option>
                ))}
              </NativeSelect>
            </label>
          ))}
      </div>
      <StudioInlineOptions
        modelId={model.id}
        controls={model.controls}
        value={draft.modelOptions}
        disabled={disabled}
        onChange={(modelOptions) => onChange({ ...draft, modelOptions })}
      />
      <Action
        aria-label={uiMessages["studio.tools.create"]()}
        disabled={
          disabled ||
          !valid ||
          (required && !draft.prompt.trim()) ||
          draft.modelId !== model.id
        }
        onClick={onGenerate}
        className="vh-primary flex min-h-12 w-full items-center justify-center gap-2 rounded-xl text-sm font-semibold"
      >
        {busy ? (
          <>
            <Loader2 size={16} className="animate-spin" />
            {uiMessages["studio.tools.creating"]()}</>
        ) : (
          <>
            {uiMessages["studio.tools.create"]()}<ArrowUpRight size={16} />
          </>
        )}
      </Action>
      <p className="text-[11px] leading-5 text-[var(--vh-text-3)]">
        {uiMessages["studio.tools.your_selected_provider_charges_for_generation_results_are_saved_in_this_project"]()}</p>
    </div>
  );
}
