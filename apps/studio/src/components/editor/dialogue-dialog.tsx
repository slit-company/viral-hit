import { m } from '@/paraglide/messages.js';
import { useMemo, useState } from 'react';
import { MessagesSquare, Loader2, Check } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Action } from '@/components/base/action';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { SuggestedTextInput } from '@/components/generation-providers/suggested-text-input';
import { apiJsonGet, apiJsonPost } from '@/lib/api-client';
import { useWorkspaceModels } from '@/core/workspace-hooks/use-workspace-metadata';
import { dialogueSpeakers, parseDialogueScript, type DialogueView } from '@/core/dialogue/contract';
import { resolveModelOptions, type ModelControl } from '@/core/generation-providers/model-controls';
import { costRequest, estimateCost, sumCosts } from '@/core/costs/pricing';
import { CostTotalText } from '@/components/generation-providers/cost-estimate';

const url = (projectId: string) => '/api/app/projects/' + encodeURIComponent(projectId) + '/dialogues';
const voiceControl = (controls?: ModelControl[]) => controls?.find(control => /^voice(_id)?$/.test(control.key) && (control.type === 'string' || control.type === 'select'));
const choices = (control?: ModelControl) => control?.type === 'select' ? control.choices : control?.type === 'string' ? control.suggestions ?? [] : [];

/** Write a conversation, give each speaker a voice, voice every line and put them on the timeline in order. */
export function DialogueDialog({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false), [script, setScript] = useState(''), [modelId, setModelId] = useState(''), [cast, setCast] = useState<Record<string, string>>({});
  const [requestId, setRequestId] = useState<string | null>(null);
  const client = useQueryClient(), catalog = useWorkspaceModels('ai-audio');
  const models = (catalog.data?.models ?? []).filter(model => model.studioTasks?.includes('text-to-speech') && model.available !== false && voiceControl(model.controls));
  const model = models.find(item => item.id === modelId) ?? models[0], control = voiceControl(model?.controls), options = choices(control);
  const lines = useMemo(() => parseDialogueScript(script), [script]), speakers = dialogueSpeakers(lines);
  // Each new speaker starts with a different voice so the conversation is easy to follow.
  const voiceOf = (speaker: string, index: number) => cast[speaker] ?? options[index % Math.max(1, options.length)]?.value ?? (control?.default as string | undefined) ?? '';
  // One generation per line, each priced by its text length on the chosen service.
  const cost = useMemo(() => {
    if (!model?.pricing || !lines.length) return null;
    let defaults: Record<string, unknown> = {};
    try { defaults = resolveModelOptions(model.controls, undefined); } catch { defaults = {}; }
    return sumCosts(lines.map(line => estimateCost(model.pricing, costRequest({ prompt: line.text, options: defaults }))));
  }, [model, lines]);
  const list = useQuery({ queryKey: ['dialogues', projectId], queryFn: () => apiJsonGet<{ dialogues: DialogueView[] }>(url(projectId)).then(result => result.dialogues), enabled: open, refetchInterval: 2_000 });
  const produce = useMutation({ mutationFn: () => { const id = crypto.randomUUID(); setRequestId(id); return apiJsonPost(url(projectId), { action: 'produce', requestId: id, modelId: model!.id, script, cast: Object.fromEntries(speakers.map((speaker, index) => [speaker, voiceOf(speaker, index)])) }); }, onSuccess: () => client.invalidateQueries({ queryKey: ['dialogues', projectId] }) });
  const place = useMutation({ mutationFn: (id: string) => apiJsonPost(url(projectId), { action: 'place', requestId: id }) });
  const current = list.data?.find(item => item.requestId === requestId) ?? null, done = current?.lines.every(line => line.state === 'succeeded') ?? false;
  return <>
    <Action type="button" onClick={() => setOpen(true)} aria-label={m['ui.dialogue.open']()} title={m['ui.dialogue.open']()}
      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--vh-border)] bg-[var(--vh-surface)] px-2.5 text-xs font-semibold text-[var(--vh-text-1)]"><MessagesSquare className="size-3.5" /></Action>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[calc(100dvh-32px)] overflow-y-auto">
        <DialogHeader><DialogTitle>{m['ui.dialogue.title']()}</DialogTitle><DialogDescription>{m['ui.dialogue.description']()}</DialogDescription></DialogHeader>
        {!models.length ? <p className="text-sm text-[var(--vh-text-2)]">{m['ui.dialogue.no_model']()}</p> : <div className="space-y-3">
          <label className="grid gap-1.5 text-xs"><span className="font-semibold">{m['ui.dialogue.model']()}</span>
            <NativeSelect value={model?.id ?? ''} onChange={event => { setModelId(event.target.value); setCast({}); }}>{models.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</NativeSelect></label>
          <label className="grid gap-1.5 text-xs"><span className="font-semibold">{m['ui.dialogue.script']()}</span>
            <Textarea value={script} maxLength={20_000} placeholder={m['ui.dialogue.placeholder']()} onChange={event => setScript(event.target.value)} className="min-h-32 text-sm" /></label>
          {speakers.length > 0 && <fieldset className="space-y-2"><legend className="text-xs font-semibold">{m['ui.dialogue.cast']()}</legend>
            {speakers.map((speaker, index) => <div key={speaker} className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)] items-center gap-2 text-xs">
              <span className="truncate font-medium">{speaker}</span>
              {control?.type === 'select' ? <NativeSelect aria-label={speaker} value={voiceOf(speaker, index)} onChange={event => setCast({ ...cast, [speaker]: event.target.value })}>{control.choices.map(choice => <option key={choice.value} value={choice.value}>{choice.label}</option>)}</NativeSelect>
                : options.length ? <SuggestedTextInput label={speaker} value={voiceOf(speaker, index)} suggestions={options} maxLength={control?.type === 'string' ? control.maxLength : 200} onChange={value => setCast({ ...cast, [speaker]: value })} />
                : <Input aria-label={speaker} value={voiceOf(speaker, index)} onChange={event => setCast({ ...cast, [speaker]: event.target.value })} />}
            </div>)}
          </fieldset>}
          <Action type="button" className="vh-primary w-full" disabled={!lines.length || produce.isPending || (current !== null && !done)} onClick={() => produce.mutate()}>{m['ui.dialogue.make']({ count: lines.length })}</Action>
          <p className="text-[11px] text-[var(--vh-text-3)]">{cost && <><CostTotalText className="font-semibold text-[var(--vh-text-2)]" total={cost} checked={model?.pricing?.checked} />{' · '}</>}{m['ui.dialogue.cost_note']()}</p>
          {(produce.error ?? place.error) && <p role="alert" className="text-xs text-red-700">{(produce.error ?? place.error)!.message}</p>}
          {current && <ol className="space-y-1.5 rounded-xl border border-[var(--vh-border)] p-3 text-xs" aria-label={m['ui.dialogue.progress']()}>
            {current.lines.map(line => <li key={line.index} className="flex items-center gap-2">
              {line.state === 'succeeded' ? <Check className="size-3.5 text-emerald-700" /> : line.state === 'failed' ? <span className="text-red-700">!</span> : <Loader2 className="size-3.5 animate-spin" />}
              <span className="font-semibold">{line.speaker}</span><span className="min-w-0 truncate text-[var(--vh-text-2)]">{line.text}</span>
            </li>)}
          </ol>}
          {current && <Action type="button" className="vh-secondary w-full" disabled={!done || place.isPending || place.isSuccess} onClick={() => place.mutate(current.requestId)}>{place.isSuccess ? m['ui.dialogue.placed']() : m['ui.dialogue.place']()}</Action>}
        </div>}
      </DialogContent>
    </Dialog>
  </>;
}
