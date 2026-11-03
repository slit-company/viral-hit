import { m } from '@/paraglide/messages.js';
import { useState } from 'react';
import { Check, Loader2, UserRoundPen } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Action } from '@/components/base/action';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { apiJsonGet, apiJsonPost } from '@/lib/api-client';
import { useWorkspaceModels } from '@/core/workspace-hooks/use-workspace-metadata';
import type { CharacterSwapPlan, CharacterSwapView, SwapVerdict } from '@/core/character-swap/contract';
import { CostTotalText } from '@/components/generation-providers/cost-estimate';

/** MiniMax H3 references first: it regenerates whole frames and follows role assignments closely. */
const RECOMMENDED = [/minimax-h3.*reference/, /animate-replace/, /seedance-2\.5.*reference/, /video-reference/, /remix-object-swap/, /reference-to-video/];
const rank = (id: string) => { const index = RECOMMENDED.findIndex(pattern => pattern.test(id)); return index < 0 ? RECOMMENDED.length : index; };
const url = (projectId: string) => '/api/app/projects/' + encodeURIComponent(projectId) + '/character-swaps';
const VERDICT: Record<SwapVerdict, () => string> = { swapped: () => m['ui.swap.verdict_swapped'](), blended: () => m['ui.swap.verdict_blended'](), kept: () => m['ui.swap.verdict_kept'](), unclear: () => m['ui.swap.verdict_unclear']() };
type Character = { id: string; name: string; status?: string };

/** Give the person in a clip a character's look while the clip's acting, timing and camera stay. */
export function CharacterSwapDialog({ projectId, clipId, disabled }: { projectId: string; clipId: string; disabled?: boolean }) {
  const [open, setOpen] = useState(false), [characterId, setCharacterId] = useState(''), [modelId, setModelId] = useState('');
  const [notes, setNotes] = useState(''), [keepSound, setKeepSound] = useState(true), [requestId, setRequestId] = useState<string | null>(null);
  const client = useQueryClient(), catalog = useWorkspaceModels('ai-video');
  const models = (catalog.data?.models ?? []).filter(model => model.available !== false && (model.referenceInputs?.video.max ?? 0) >= 1 && (model.referenceInputs?.image.max ?? 0) >= 1).sort((left, right) => rank(left.id) - rank(right.id));
  const characters = useQuery({ queryKey: ['swap-characters'], enabled: open, queryFn: () => apiJsonGet<{ characters: Character[] }>('/api/app/characters').then(result => result.characters.filter(item => item.status !== 'archived')) });
  const model = models.find(item => item.id === modelId) ?? models[0], character = characterId || characters.data?.[0]?.id || '';
  const target = model && character ? { clipId, modelId: model.id, characterId: character, notes, keepSound } : null;
  const plan = useQuery({ queryKey: ['swap-plan', projectId, target], enabled: open && Boolean(target), retry: false, queryFn: () => apiJsonPost<{ plan: CharacterSwapPlan }>(url(projectId), { action: 'plan', ...target! }).then(result => result.plan) });
  const swaps = useQuery({ queryKey: ['character-swaps', projectId, clipId], enabled: open, refetchInterval: 2_500, queryFn: () => apiJsonGet<{ swaps: CharacterSwapView[] }>(url(projectId) + '?clipId=' + encodeURIComponent(clipId)).then(result => result.swaps) });
  const refresh = () => client.invalidateQueries({ queryKey: ['character-swaps', projectId, clipId] });
  const produce = useMutation({ onSuccess: refresh, mutationFn: () => { const id = crypto.randomUUID(); setRequestId(id); return apiJsonPost(url(projectId), { action: 'produce', requestId: id, ...target! }); } });
  const evaluate = useMutation({ onSuccess: refresh, mutationFn: (id: string) => apiJsonPost(url(projectId), { action: 'evaluate', requestId: id }) });
  const place = useMutation({ onSuccess: refresh, mutationFn: (id: string) => apiJsonPost(url(projectId), { action: 'place', requestId: id }) });
  const current = swaps.data?.find(item => item.requestId === requestId) ?? swaps.data?.[0] ?? null;
  const done = Boolean(current?.pieces.length) && current!.pieces.every(piece => piece.state === 'succeeded');
  const error = (plan.error ?? produce.error ?? evaluate.error ?? place.error) as Error | null;
  const label = 'grid gap-1.5 text-xs', title = 'font-semibold';
  return <>
    <Action type="button" disabled={disabled} onClick={() => setOpen(true)} className="col-span-2 inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-[var(--vh-border)] bg-[var(--vh-control)] text-[11px] font-[540] text-[var(--vh-text-2)] transition hover:text-[var(--vh-text-1)] disabled:opacity-30">
      <UserRoundPen className="size-3.5" />{m['ui.swap.open']()}
    </Action>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[calc(100dvh-32px)] overflow-y-auto">
        <DialogHeader><DialogTitle>{m['ui.swap.title']()}</DialogTitle><DialogDescription>{m['ui.swap.description']()}</DialogDescription></DialogHeader>
        {!models.length ? <p className="text-sm text-[var(--vh-text-2)]">{m['ui.swap.no_model']()}</p>
          : characters.data && !characters.data.length ? <p className="text-sm text-[var(--vh-text-2)]">{m['ui.swap.no_character']()}</p>
          : <div className="space-y-3">
            <label className={label}><span className={title}>{m['ui.swap.character']()}</span>
              <NativeSelect aria-label={m['ui.swap.character']()} value={character} onChange={event => setCharacterId(event.target.value)}>{(characters.data ?? []).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</NativeSelect></label>
            <label className={label}><span className={title}>{m['ui.swap.model']()}</span>
              <NativeSelect aria-label={m['ui.swap.model']()} value={model?.id ?? ''} onChange={event => setModelId(event.target.value)}>{models.map(item => <option key={item.id} value={item.id}>{item.name}{item.providerLabel ? ' · ' + item.providerLabel : ''}</option>)}</NativeSelect></label>
            <label className={label}><span className={title}>{m['ui.swap.notes']()}</span>
              <Input value={notes} maxLength={600} placeholder={m['ui.swap.notes_placeholder']()} onChange={event => setNotes(event.target.value)} /></label>
            <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={keepSound} onChange={event => setKeepSound(event.target.checked)} />{m['ui.swap.keep_sound']()}</label>
            {plan.data && <div className="space-y-1 text-xs text-[var(--vh-text-2)]">
              <p><span className="font-semibold text-[var(--vh-text-1)]">{m['ui.swap.pieces']({ count: plan.data.pieces.length })}</span> · <CostTotalText total={plan.data.cost} /></p>
              <details><summary className="cursor-pointer">{m['ui.swap.prompt']()}</summary><p className="mt-1 break-words">{plan.data.prompt}</p></details>
            </div>}
            <Action type="button" className="vh-primary w-full" disabled={!plan.data || produce.isPending || (current !== null && !done && current.requestId === requestId)} onClick={() => produce.mutate()}>
              {m['ui.swap.make']()}
            </Action>
            {error && <p role="alert" className="text-xs text-red-700">{error.message}</p>}
            {current && <ol aria-label={m['ui.swap.progress']()} className="space-y-1.5 rounded-xl border border-[var(--vh-border)] p-3 text-xs">
              {current.pieces.map(piece => <li key={piece.index} className="flex items-center gap-2">
                {piece.state === 'succeeded' ? <Check className="size-3.5 text-emerald-700" /> : piece.state === 'failed' ? <span className="text-red-700">!</span> : <Loader2 className="size-3.5 animate-spin" />}
                <span className="font-semibold">{piece.start.toFixed(1)}–{(piece.start + piece.duration).toFixed(1)}s</span>
                {piece.evaluation && <span className="rounded-full bg-[var(--vh-control)] px-2 py-0.5">{VERDICT[piece.evaluation.verdict]()}</span>}
                {piece.error && <span className="min-w-0 truncate text-red-700">{piece.error}</span>}
              </li>)}
            </ol>}
            {current && done && <div className="grid grid-cols-2 gap-2">
              <Action type="button" className="vh-secondary" disabled={evaluate.isPending} onClick={() => evaluate.mutate(current.requestId)}>{evaluate.isPending ? <Loader2 className="size-3.5 animate-spin" /> : m['ui.swap.check']()}</Action>
              <Action type="button" className="vh-primary" disabled={place.isPending || current.placedAt !== null} onClick={() => place.mutate(current.requestId)}>{current.placedAt !== null ? m['ui.swap.placed']() : m['ui.swap.place']()}</Action>
            </div>}
          </div>}
      </DialogContent>
    </Dialog>
  </>;
}
