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
import { StudioAnalysisSources } from './studio-analysis-sources';
import type { StudioAnalysisController } from './use-studio-analysis';

export function StudioAnalysisComposer({ projectId, analysis, isBusy, onMediaChange, onGenerate }: {
  projectId: string; analysis: StudioAnalysisController; isBusy: boolean; onMediaChange: (media: StudioMedia) => void; onGenerate: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const disabled = isBusy || analysis.busy;
  const { draft, models, model } = analysis;
  return <div className="absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-[var(--vh-bg)] via-[var(--vh-bg)]/96 to-transparent px-3 pb-3 pt-12 sm:px-6 sm:pb-5">
    <div className={cn('mx-auto w-full max-w-[1138px] space-y-3 p-3.5', composerCardClassName)} data-vh-composer="">
      {analysis.unreadableDraft && <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--vh-text-2)]" role="status">
        <span>The saved draft is unreadable and retained. New edits are not saved yet.</span>
        <Action className="vh-secondary" disabled={disabled} onClick={analysis.replaceUnreadableDraft}>Replace unreadable draft</Action>
      </div>}
      <textarea aria-label="Analysis prompt" placeholder="Describe what to review across the selected media." value={draft.prompt} disabled={disabled} onChange={event => analysis.update({ prompt: truncatePromptToMaxChars(event.target.value, 12_000) })} className="h-20 w-full resize-none bg-transparent text-sm leading-6 text-[var(--vh-text-1)] outline-none placeholder:text-[var(--vh-text-2)]" />
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <WorkspaceSelect ariaLabel="Media type" value="analysis" options={[{ value: 'image', label: 'Image' }, { value: 'video', label: 'Video' }, { value: 'audio', label: 'Audio' }, { value: 'analysis', label: 'Analysis' }]} onChange={value => { if (!disabled) onMediaChange(value as StudioMedia); }} />
        <NativeSelect className="min-w-0 flex-1 basis-48 sm:max-w-80" aria-label="Analysis model" disabled={disabled} value={draft.modelId} onChange={event => analysis.update({ modelId: event.target.value })}>
          {!model && <option value={draft.modelId}>{draft.modelId} — unavailable</option>}
          {models.map(item => <option key={item.id} value={item.id} disabled={item.available === false}>{item.name}{item.available === false ? ' — not configured' : ''}</option>)}
        </NativeSelect>
        {draft.modelId === VIDEO_ANALYSIS_MODEL_ID && <NativeSelect className="w-auto" aria-label="Analysis depth" disabled={disabled} value={draft.depth} onChange={event => analysis.update({ depth: event.target.value === 'deep' ? 'deep' : 'standard' })}><option value="standard">Standard</option><option value="deep">Deep</option></NativeSelect>}
        <ModelOptions modelId={draft.modelId} value={draft.modelOptions} disabled={disabled} onChange={modelOptions => analysis.update({ modelOptions })} />
        <StudioAnalysisSources projectId={projectId} analysis={analysis} disabled={disabled} />
        <Action className="vh-secondary flex items-center gap-1.5" aria-label="Upload analysis files" disabled={disabled || !model || model.available === false} onClick={() => input.current?.click()}><Upload size={15} />Upload files</Action>
        <input ref={input} aria-label="Analysis files" type="file" className="hidden" multiple accept="image/png,image/jpeg,image/webp,video/mp4,video/quicktime,video/webm,audio/mpeg,audio/wav,audio/mp4,audio/ogg,audio/aac" onChange={event => { void analysis.upload(Array.from(event.target.files ?? [])); event.target.value = ''; }} />
        <div className="ml-auto flex items-center gap-2"><span className="text-[10px] tabular-nums text-[var(--vh-text-2)]">{draft.prompt.length}/12000</span>
          <Action className={composerGenerateButtonClassName} aria-label={isBusy ? 'Analyzing' : 'Analyze'} disabled={disabled || !model || model.available === false || !draft.prompt.trim() || !draft.sources.length} onClick={onGenerate}>{disabled ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}</Action>
        </div>
      </div>
    </div>
  </div>;
}
