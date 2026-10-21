import { ArrowUp, Loader2 } from 'lucide-react';
import { Action } from '@/components/base/action';
import { NativeSelect } from '@/components/ui/native-select';
import { WorkspaceSelect } from '@/components/app/workspace-select';
import { composerCardClassName, composerGenerateButtonClassName } from '@/components/app/composer-styles';
import { ModelOptions } from '@/components/generation-providers/model-options';
import { Link } from '@/core/i18n/navigation';
import { MAX_GENERATION_PROMPT_CHARS, truncatePromptToMaxChars } from '@/core/effects/validation';
import type { StudioMedia } from '@/core/studio/studio-runtime';
import { cn } from '@/lib/utils';
import type { StudioAudioController } from './use-studio-audio';

export function StudioAudioComposer({ audio, isBusy, onMediaChange, onGenerate }: { audio: StudioAudioController; isBusy: boolean; onMediaChange: (media: StudioMedia) => void; onGenerate: () => void }) {
  const { draft, models, model } = audio;
  return <div className="absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-[var(--vh-bg)] via-[var(--vh-bg)]/96 to-transparent px-3 pb-3 pt-12 sm:px-6 sm:pb-5">
    <div className={cn('mx-auto w-full max-w-[1138px] space-y-3 p-3.5', composerCardClassName)} data-vh-composer="">
      {audio.unreadableDraft && <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--vh-text-2)]" role="status"><span>The saved audio draft is unreadable and retained. New edits are not saved yet.</span><Action className="vh-secondary" disabled={isBusy} onClick={audio.replaceUnreadableDraft}>Replace unreadable draft</Action></div>}
      <textarea aria-label="Audio prompt" placeholder="Describe the sound, music or words to speak for your selected model." value={draft.prompt} disabled={isBusy} onChange={event => audio.update({ prompt: truncatePromptToMaxChars(event.target.value, MAX_GENERATION_PROMPT_CHARS) })} className="h-20 w-full resize-none bg-transparent text-sm leading-6 text-[var(--vh-text-1)] outline-none placeholder:text-[var(--vh-text-2)]" />
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <WorkspaceSelect ariaLabel="Media type" value="audio" options={[{ value: 'image', label: 'Image' }, { value: 'video', label: 'Video' }, { value: 'audio', label: 'Audio' }, { value: 'analysis', label: 'Analysis' }]} onChange={value => { if (!isBusy) onMediaChange(value as StudioMedia); }} />
        <NativeSelect className="min-w-0 flex-1 basis-48 sm:max-w-80" aria-label="Audio model" disabled={isBusy} value={draft.modelId} onChange={event => audio.update({ modelId: event.target.value })}>
          {!model && <option value={draft.modelId}>{draft.modelId ? draft.modelId + ' — unavailable' : 'Choose an audio model'}</option>}
          {models.map(item => <option key={item.id} value={item.id} disabled={item.available === false}>{item.name}{item.available === false ? ' — not configured' : ''}</option>)}
        </NativeSelect>
        {model && <ModelOptions modelId={model.id} value={draft.modelOptions} disabled={isBusy} onChange={modelOptions => audio.update({ modelOptions })} />}
        <div className="ml-auto flex items-center gap-2"><span className="text-[10px] tabular-nums text-[var(--vh-text-2)]">{draft.prompt.length}/{MAX_GENERATION_PROMPT_CHARS}</span><Action className={composerGenerateButtonClassName} aria-label={isBusy ? 'Generating audio' : 'Generate audio'} disabled={isBusy || !model || model.available === false || !draft.prompt.trim()} onClick={onGenerate}>{isBusy ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}</Action></div>
      </div>
      <p className="break-words text-xs leading-5 text-[var(--vh-text-2)]">{model ? model.name : 'No selected audio model is available.'} · <Link href="/runtime-packages" className="underline underline-offset-4">Manage audio providers</Link></p>
    </div>
  </div>;
}
