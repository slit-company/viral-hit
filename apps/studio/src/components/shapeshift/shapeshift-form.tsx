import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Film, Loader2, Shapes } from 'lucide-react';
import { m } from '@/paraglide/messages.js';
import { Action } from '@/components/base/action';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { CostTotalText } from '@/components/generation-providers/cost-estimate';
import { apiJsonGet } from '@/lib/api-client';
import type { ShapeshiftNote } from '@/core/shapeshift/contract';
import { MAX_SUBJECT_IMAGES, MAX_VARIATIONS, SHAPESHIFT_QUALITIES, type ShapeshiftMode, type ShapeshiftQuality, type ShapeshiftStyle } from '@/core/shapeshift/options';
import { MediaPickerDialog, videoGroups } from './media-picker';
import { ModeToggle, PictureStrip, Section, Segmented, StylePicker } from './shapeshift-fields';
import { useDebounced, useProduceShapeshift, useProjectMedia, useShapeshiftModels, useShapeshiftPlan, type ShapeshiftDraft } from './use-shapeshift';

type Character = { id: string; name: string; status?: string };
const seconds = (value: string) => { const number = Number.parseFloat(value); return value.trim() && Number.isFinite(number) && number >= 0 ? number : undefined; };
const VARIATIONS = Array.from({ length: MAX_VARIATIONS }, (_, index) => ({ value: index + 1, label: String(index + 1) }));

function noteText(note: ShapeshiftNote) {
  if (note.kind === 'skipped') return m['ui.shapeshift.note_skipped']({ services: note.services.join(', ') });
  if (note.kind === 'images-trimmed') return m['ui.shapeshift.note_trimmed']({ model: note.modelName, used: note.used, given: note.given });
  return m['ui.shapeshift.note_repeated']({ model: note.modelName });
}

/** Every setting of a Shapeshift run, its plan and price, and the button that starts it. */
export function ShapeshiftForm({ projectId }: { projectId: string }) {
  const client = useQueryClient(), media = useProjectMedia(projectId);
  const characters = useQuery({ queryKey: ['shapeshift-characters'], queryFn: () => apiJsonGet<{ characters: Character[] }>('/api/app/characters').then(result => result.characters.filter(item => item.status !== 'archived')) });
  const [mode, setMode] = useState<ShapeshiftMode>('motion-transfer'), [picking, setPicking] = useState<'video' | 'image' | null>(null);
  const [sourceId, setSourceId] = useState<string | null>(null), [length, setLength] = useState<number | null>(null), [start, setStart] = useState(''), [end, setEnd] = useState('');
  const [images, setImages] = useState<string[]>([]), [characterId, setCharacterId] = useState('');
  const [style, setStyle] = useState<ShapeshiftStyle>('none'), [promptOn, setPromptOn] = useState(false), [prompt, setPrompt] = useState('');
  const [modelId, setModelId] = useState('auto'), [quality, setQuality] = useState<ShapeshiftQuality>('720p'), [variations, setVariations] = useState(1), [keepSound, setKeepSound] = useState(true);
  const models = useShapeshiftModels(projectId, mode), produce = useProduceShapeshift(projectId);
  const videos = media.data?.videos ?? [], pictures = media.data?.images ?? [];
  const source = videos.find(video => video.id === sourceId) ?? null;
  const model = models.data?.some(item => item.id === modelId) ? modelId : 'auto';
  const draft: ShapeshiftDraft | null = source && (images.length || characterId) ? {
    mode, sourceAssetId: source.id, start: seconds(start), end: seconds(end), imageAssetIds: images, characterId: characterId || undefined,
    style: mode === 'motion-transfer' ? style : 'none', prompt: promptOn ? prompt.trim() : '', modelId: model, quality, variations, keepSound,
  } : null;
  const plan = useShapeshiftPlan(projectId, useDebounced(draft));
  const from = seconds(start) ?? 0, to = Math.min(seconds(end) ?? length ?? 0, length ?? Infinity);
  const toggleImage = (id: string) => setImages(current => current.includes(id) ? current.filter(item => item !== id) : current.length < MAX_SUBJECT_IMAGES ? [...current, id] : current);
  const refresh = () => client.invalidateQueries({ queryKey: ['shapeshift-media', projectId] });
  const error = (produce.error ?? (draft ? plan.error : null)) as Error | null;
  return <aside aria-label={m['ui.shapeshift.title']()} className="min-w-0 space-y-6 border-b border-[var(--vh-border)] bg-[var(--vh-surface)] p-5 lg:overflow-y-auto lg:border-b-0 lg:border-r">
    <header className="space-y-1.5">
      <h1 className="flex items-center gap-2 text-xl font-semibold tracking-[-0.02em]"><Shapes className="size-5" aria-hidden="true" />{m['ui.shapeshift.title']()}</h1>
      <p className="text-xs leading-5 text-[var(--vh-text-2)]">{m['ui.shapeshift.description']()}</p>
    </header>
    <ModeToggle value={mode} onChange={setMode} />
    <Section title={m['ui.shapeshift.source']()} hint={m['ui.shapeshift.source_hint']()}>
      {source ? <div className="space-y-2">
        <video key={source.id} src={source.publicUrl} controls muted playsInline preload="metadata" onLoadedMetadata={event => setLength(event.currentTarget.duration || null)} className="aspect-video w-full rounded-xl bg-black object-contain" />
        <div className="flex items-center gap-2 text-[11px] text-[var(--vh-text-2)]"><Film className="size-3.5 shrink-0" aria-hidden="true" /><span className="truncate">{source.filename ?? source.id}</span>
          <Action type="button" className="ml-auto shrink-0 font-semibold text-[var(--vh-text-1)] underline-offset-4 hover:underline" onClick={() => setPicking('video')}>{m['ui.shapeshift.change_video']()}</Action></div>
        <fieldset className="grid grid-cols-2 gap-2">
          <legend className="mb-1.5 text-[11px] font-semibold">{m['ui.shapeshift.range']()}</legend>
          <label className="grid gap-1 text-[11px] text-[var(--vh-text-2)]">{m['ui.shapeshift.start']()}<Input inputMode="decimal" placeholder="0" value={start} onChange={event => setStart(event.target.value)} /></label>
          <label className="grid gap-1 text-[11px] text-[var(--vh-text-2)]">{m['ui.shapeshift.end']()}<Input inputMode="decimal" placeholder={length ? length.toFixed(1) : ''} value={end} onChange={event => setEnd(event.target.value)} /></label>
        </fieldset>
        {length !== null && to > from && <p className="text-[11px] tabular-nums text-[var(--vh-text-3)]">{m['ui.shapeshift.range_summary']({ start: from.toFixed(1), end: to.toFixed(1), length: (to - from).toFixed(1) })}</p>}
      </div> : <Action type="button" onClick={() => setPicking('video')} className="grid aspect-video w-full place-items-center rounded-xl border border-dashed border-[var(--vh-border)] text-xs font-semibold text-[var(--vh-text-2)] transition hover:border-[var(--vh-text-3)] hover:text-[var(--vh-text-1)]">
        <span className="flex flex-col items-center gap-2"><Film className="size-5" aria-hidden="true" />{m['ui.shapeshift.choose_video']()}</span>
      </Action>}
    </Section>
    <Section title={m['ui.shapeshift.subject']()} hint={mode === 'motion-transfer' ? m['ui.shapeshift.subject_hint_motion']() : m['ui.shapeshift.subject_hint_swap']()}>
      <PictureStrip pictures={pictures} selected={images} onRemove={id => setImages(current => current.filter(item => item !== id))} onAdd={() => setPicking('image')} />
      <label className="grid gap-1.5 text-[11px] font-semibold">{m['ui.swap.character']()}
        <NativeSelect aria-label={m['ui.swap.character']()} value={characterId} onChange={event => setCharacterId(event.target.value)}>
          <option value="">{m['ui.shapeshift.no_character']()}</option>
          {(characters.data ?? []).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </NativeSelect></label>
    </Section>
    {mode === 'motion-transfer' && <Section title={m['ui.shapeshift.style']()}><StylePicker value={style} onChange={setStyle} /></Section>}
    <section className="space-y-2.5">
      <label className="flex items-center gap-2 text-xs font-semibold"><input type="checkbox" checked={promptOn} onChange={event => setPromptOn(event.target.checked)} />{m['ui.shapeshift.prompt_toggle']()}</label>
      {promptOn && <Textarea value={prompt} maxLength={1000} rows={3} placeholder={m['ui.shapeshift.prompt_placeholder']()} onChange={event => setPrompt(event.target.value)} />}
    </section>
    <Section title={m['ui.swap.model']()}>
      <NativeSelect aria-label={m['ui.swap.model']()} value={model} onChange={event => setModelId(event.target.value)}>
        <option value="auto">{m['ui.shapeshift.model_auto']()}</option>
        {(models.data ?? []).map(item => <option key={item.id} value={item.id} disabled={item.credit === 'empty'}>
          {(item.credit === 'empty' ? m['ui.shapeshift.model_empty']({ name: item.name }) : item.name) + (item.name.includes(item.providerLabel) ? '' : ' · ' + item.providerLabel)}</option>)}
      </NativeSelect>
      <div className="grid grid-cols-2 gap-3">
        <label className="grid gap-1.5 text-[11px] font-semibold">{m['ui.shapeshift.quality']()}<Segmented label={m['ui.shapeshift.quality']()} value={quality} options={SHAPESHIFT_QUALITIES.map(value => ({ value, label: value }))} onChange={setQuality} /></label>
        <label className="grid gap-1.5 text-[11px] font-semibold">{m['ui.shapeshift.variations']()}<Segmented label={m['ui.shapeshift.variations']()} value={variations} options={VARIATIONS} onChange={setVariations} /></label>
      </div>
      <p className="text-[11px] leading-4 text-[var(--vh-text-3)]">{m['ui.shapeshift.variations_hint']()}</p>
      <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={keepSound} onChange={event => setKeepSound(event.target.checked)} />{m['ui.shapeshift.keep_sound']()}</label>
    </Section>
    <div className="space-y-2 rounded-xl bg-[var(--vh-control)] p-3 text-xs">
      {!source ? <p className="text-[var(--vh-text-2)]">{m['ui.shapeshift.need_source']()}</p>
        : !draft ? <p className="text-[var(--vh-text-2)]">{m['ui.shapeshift.need_subject']()}</p>
        : plan.data ? <>
          <p className="flex flex-wrap items-center gap-x-1.5"><span className="font-semibold">{m['ui.shapeshift.generations']({ count: plan.data.takes.reduce((sum, take) => sum + take.pieces.length, 0) })}</span>·<CostTotalText total={plan.data.cost} /></p>
          <ul className="space-y-0.5 text-[var(--vh-text-2)]">{plan.data.takes.map((take, index) => <li key={index}>{m['ui.shapeshift.take_line']({ model: take.modelName, pieces: take.pieces.length })}</li>)}</ul>
          {plan.data.notes.map((note, index) => <p key={index} className="text-[var(--vh-text-3)]">{noteText(note)}</p>)}
          <details><summary className="cursor-pointer text-[var(--vh-text-2)]">{m['ui.shapeshift.prompt_details']()}</summary><p className="mt-1 break-words text-[var(--vh-text-2)]">{plan.data.takes[0]?.prompt}</p></details>
        </> : plan.isFetching || plan.isPending ? <p className="inline-flex items-center gap-1.5 text-[var(--vh-text-2)]"><Loader2 className="size-3.5 animate-spin" />{m['ui.shapeshift.planning']()}</p> : null}
      {error && <p role="alert" className="break-words text-red-700">{error.message}</p>}
    </div>
    <Action type="button" className="vh-primary inline-flex h-11 w-full items-center justify-center gap-2 text-sm font-semibold" disabled={!draft || !plan.data || produce.isPending} onClick={() => draft && produce.mutate(draft)}>
      {produce.isPending && <Loader2 className="size-4 animate-spin" />}{produce.isPending ? m['ui.shapeshift.starting']() : m['ui.shapeshift.generate']()}
    </Action>
    <MediaPickerDialog projectId={projectId} open={picking === 'video'} onOpenChange={open => setPicking(open ? 'video' : null)} kind="video" title={m['ui.shapeshift.library_title']()}
      description={m['ui.shapeshift.library_description']()} empty={m['ui.shapeshift.no_videos']()} groups={videoGroups(videos)} selected={source ? [source.id] : []}
      onToggle={id => { setSourceId(id); setLength(null); setStart(''); setEnd(''); setPicking(null); }} onUploaded={id => { void refresh(); setSourceId(id); setLength(null); setPicking(null); }} />
    <MediaPickerDialog projectId={projectId} open={picking === 'image'} onOpenChange={open => setPicking(open ? 'image' : null)} kind="image" title={m['ui.shapeshift.pictures_title']()}
      description={m['ui.shapeshift.pictures_description']({ max: MAX_SUBJECT_IMAGES })} empty={m['ui.shapeshift.no_images']()} groups={[{ label: m['ui.shapeshift.pictures_title'](), assets: pictures }]}
      selected={images} onToggle={toggleImage} onUploaded={id => { void refresh(); toggleImage(id); }}
      footer={<Action type="button" className="vh-primary h-10 w-full text-sm font-semibold" onClick={() => setPicking(null)}>{m['ui.spending.done']()}</Action>} />
  </aside>;
}
