import { m as uiMessages } from '@/paraglide/messages.js';
import { StudioInlineOptions } from './studio-inline-options';
import { StudioPromptField } from './studio-prompt-field';
import { useRef } from 'react';
import { ArrowUp, Loader2, Upload } from 'lucide-react';
import { Action } from '@/components/base/action';
import { NativeSelect } from '@/components/ui/native-select';
import { WorkspaceSelect } from '@/components/app/workspace-select';
import { composerCardClassName, composerGenerateButtonClassName } from '@/components/app/composer-styles';
import { ModelOptions } from '@/components/generation-providers/model-options';
import { VIDEO_ANALYSIS_MODEL_ID } from '@/core/effects/video-analysis';
import { truncatePromptToMaxChars } from '@/core/effects/validation';
import type { StudioMedia } from '@/core/studio/studio-runtime';
import { cn } from '@/lib/utils';
import { StudioMediaSources } from './studio-media-sources';
import { resolveAnalysisInputs } from '@/core/generation-providers/analysis-inputs';
import type { StudioAnalysisController } from './use-studio-analysis';

export function StudioAnalysisComposer({ projectId, analysis, isBusy, onMediaChange, onGenerate, panel = false }: {
  projectId: string; analysis: StudioAnalysisController; isBusy: boolean; onMediaChange: (media: StudioMedia) => void; onGenerate: () => void; panel?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const disabled = isBusy || analysis.busy;
  const { draft, models, model } = analysis;
  return <div className={panel ? "space-y-4" : "absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-[var(--vh-bg)] via-[var(--vh-bg)]/96 to-transparent px-3 pb-3 pt-12 sm:px-6 sm:pb-5"}>
    <div className={cn(panel ? 'space-y-4' : 'mx-auto w-full max-w-[1138px] space-y-3 p-3.5', !panel && composerCardClassName)} data-vh-composer="">
      {analysis.unreadableDraft && <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--vh-text-2)]" role="status">
        <span>{uiMessages["studio.media.the_saved_draft_is_unreadable_and_retained_new_edits_are_not_saved_yet_fe0b"]()}</span>
        <Action className="vh-secondary" disabled={disabled} onClick={analysis.replaceUnreadableDraft}>{uiMessages["studio.media.replace_unreadable_draft_1e57"]()}</Action>
      </div>}
      <StudioPromptField panel={panel} label={uiMessages["studio.media.analysis_prompt_48f9"]()} placeholder={uiMessages["studio.media.describe_what_to_review_across_the_selected_media_7db8"]()} value={draft.prompt} disabled={disabled} onChange={prompt => analysis.update({ prompt: truncatePromptToMaxChars(prompt, 12_000) })} />
      {panel && model && <StudioInlineOptions modelId={model.id} controls={model.controls} value={draft.modelOptions} disabled={disabled} onChange={modelOptions => analysis.update({ modelOptions })} />}
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {!panel && <WorkspaceSelect ariaLabel={uiMessages["ui.studio.media_type"]()} value="analysis" options={[{ value: 'image', label: uiMessages["studio.tools.image"]() }, { value: 'video', label: uiMessages["studio.tools.video"]() }, { value: 'audio', label: uiMessages["studio.media.audio_acda"]() }, { value: 'analysis', label: uiMessages["studio.tools.analysis"]() }]} onChange={value => { if (!disabled) onMediaChange(value as StudioMedia); }} />}
        {!panel && <NativeSelect className="min-w-0 flex-1 basis-48 sm:max-w-80" aria-label={uiMessages["studio.media.analysis_model_7dc8"]()} disabled={disabled} value={draft.modelId} onChange={event => analysis.update({ modelId: event.target.value })}>
          {!model && <option value={draft.modelId}>{draft.modelId} {uiMessages["studio.media.unavailable_ed9f"]()}</option>}
          {models.map(item => <option key={item.id} value={item.id} disabled={item.available === false}>{item.name}{item.available === false ? uiMessages["studio.controls.not_configured"]() : ''}</option>)}
        </NativeSelect>}
        {draft.modelId === VIDEO_ANALYSIS_MODEL_ID && <NativeSelect className="w-auto" aria-label={uiMessages["studio.media.analysis_depth_903e"]()} disabled={disabled} value={draft.depth} onChange={event => analysis.update({ depth: event.target.value === 'deep' ? 'deep' : 'standard' })}><option value="standard">{uiMessages["ui.creative-canvas.standard"]()}</option><option value="deep">{uiMessages["studio.media.deep_be7a"]()}</option></NativeSelect>}
        {!panel && <ModelOptions modelId={draft.modelId} value={draft.modelOptions} disabled={disabled} onChange={modelOptions => analysis.update({ modelOptions })} />}
        <StudioMediaSources projectId={projectId} sources={draft.sources} limits={resolveAnalysisInputs(model?.analysisInputs)} onAdd={analysis.add} onRemove={id => analysis.update({ sources: draft.sources.filter(source => source.id !== id) })} label={uiMessages["studio.media.analysis_62c7"]()} disabled={disabled} />
        <Action className="vh-secondary flex items-center gap-1.5" aria-label={uiMessages["studio.media.upload_analysis_files_59fc"]()} disabled={disabled || !model || model.available === false} onClick={() => input.current?.click()}><Upload size={15} />{uiMessages["studio.media.upload_files_41ac"]()}</Action>
        <input ref={input} aria-label={uiMessages["studio.media.analysis_files_da59"]()} type="file" className="hidden" multiple accept="image/png,image/jpeg,image/webp,video/mp4,video/quicktime,video/webm,audio/mpeg,audio/wav,audio/mp4,audio/ogg,audio/aac" onChange={event => { void analysis.upload(Array.from(event.target.files ?? [])); event.target.value = ''; }} />
        <div className="ml-auto flex items-center gap-2"><span className="text-[10px] tabular-nums text-[var(--vh-text-2)]">{draft.prompt.length}/12000</span>
          <Action className={composerGenerateButtonClassName} aria-label={isBusy ? uiMessages["studio.controls.analyzing"]() : uiMessages["studio.controls.analyze"]()} disabled={disabled || !model || model.available === false || !draft.prompt.trim() || !draft.sources.length} onClick={onGenerate}>{disabled ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}<span>{isBusy ? uiMessages["studio.controls.analyzing"]() : uiMessages["studio.controls.analyze"]()}</span></Action>
        </div>
      </div>
    </div>
  </div>;
}
