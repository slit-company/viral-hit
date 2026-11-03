import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Repeat2 } from 'lucide-react';
import { m } from '@/paraglide/messages.js';
import { ProductPageShell } from '@/components/app/product-page-shell';
import { Action } from '@/components/base/action';
import { NativeSelect } from '@/components/ui/native-select';
import { TRANSITION_LABELS } from '@/components/editor/transition-labels';
import type { TimelineTransitionKind } from '@/core/editor/transition-contract';
import { Link } from '@/core/i18n/navigation';
import type { RemixMaterial } from '@/core/remix/contract';
import { assignRemixMaterials } from '@/core/remix/grammar';
import { fetchRecentAssets } from '@/core/workspace-lib/app/workspace-client-api';
import { apiJsonGet } from '@/lib/api-client';
import { AssetChoiceGrid, type ChoiceAsset } from './asset-choice-grid';
import { RemixShots } from './remix-shots';
import { REMIX_RUNNING, useAnalyzeReference, useBuildRemix, useRemixes } from './use-remix';

const JOINS: readonly (TimelineTransitionKind | 'none')[] = ['none', 'crossfade', 'fade-black', 'slide-left', 'wipe-left', 'zoom-in'];

/** Keep a hit's cut rhythm and soundtrack, swap in your own shots, then finish it in the editor. */
export function RemixPage({ projectId }: { projectId: string }) {
  const project = useQuery({ queryKey: ['remix-project', projectId], queryFn: () => apiJsonGet<{ projects: Array<{ id: string; name: string }> }>('/api/app/projects').then(result => result.projects.find(item => item.id === projectId)), staleTime: 30_000 });
  const assets = useQuery({ queryKey: ['remix-assets', projectId], queryFn: () => fetchRecentAssets(projectId), staleTime: 10_000 });
  const remixes = useRemixes(projectId), analyze = useAnalyzeReference(projectId), build = useBuildRemix(projectId);
  const [referenceId, setReferenceId] = useState<string | null>(null);
  const [materials, setMaterials] = useState<string[]>([]);
  const [keepSoundtrack, setKeepSoundtrack] = useState(true), [keepCamera, setKeepCamera] = useState(true), [keepText, setKeepText] = useState(false), [keepSpeed, setKeepSpeed] = useState(true);
  const [join, setJoin] = useState<TimelineTransitionKind | 'none'>('none');
  const videos: ChoiceAsset[] = (assets.data?.videos ?? []).map(asset => ({ ...asset, kind: 'video' }));
  const visuals: ChoiceAsset[] = [...videos, ...(assets.data?.images ?? []).map(asset => ({ ...asset, kind: 'image' as const }))];
  const reference = referenceId ?? remixes.data?.[0]?.sourceAssetId ?? null;
  const remix = remixes.data?.find(item => item.sourceAssetId === reference);
  const library = useMemo(() => new Map(visuals.map(asset => [asset.id, asset])), [visuals]);
  const chosen: RemixMaterial[] = materials.flatMap(id => {
    const asset = library.get(id);
    return asset ? [{ assetId: id, kind: asset.kind, duration: asset.durationMs ? asset.durationMs / 1000 : null, name: asset.filename?.trim() || id }] : [];
  });
  const plan = remix?.grammar && chosen.length ? assignRemixMaterials(remix.grammar, chosen) : null;
  const analyzing = analyze.isPending || Boolean(remix && REMIX_RUNNING.has(remix.state));
  const toggle = (id: string) => setMaterials(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]);
  return <ProductPageShell projectId={projectId} workspaceName={project.data?.name} section="remix">
    <div className="grid min-h-0 flex-1 overflow-y-auto lg:grid-cols-[440px_minmax(0,1fr)] lg:overflow-hidden">
      <aside aria-label={m['ui.remix.heading']()} className="min-w-0 space-y-6 border-b border-[var(--vh-border)] bg-[var(--vh-surface)] p-5 lg:overflow-y-auto lg:border-b-0 lg:border-r">
        <div className="space-y-1.5"><h1 className="flex items-center gap-2 text-xl font-semibold tracking-[-0.02em]"><Repeat2 className="size-5" aria-hidden="true" />{m['ui.remix.heading']()}</h1>
          <p className="text-xs leading-5 text-[var(--vh-text-2)]">{m['ui.remix.description']()}</p></div>
        <section className="space-y-2.5">
          <h2 className="text-xs font-semibold">{m['ui.remix.reference']()}</h2>
          {videos.length ? <AssetChoiceGrid assets={videos} selected={reference ? [reference] : []} label={m['ui.remix.reference']()} onToggle={id => setReferenceId(id)} />
            : <p className="text-xs leading-5 text-[var(--vh-text-2)]">{m['ui.remix.reference_empty']()}</p>}
          <Action type="button" className="vh-primary inline-flex w-full items-center justify-center gap-2" disabled={!reference || analyzing} onClick={() => reference && analyze.mutate(reference)}>
            {analyzing ? <Loader2 className="size-4 animate-spin" /> : null}{analyzing ? m['ui.remix.analyzing']() : m['ui.remix.analyze']()}
          </Action>
        </section>
        <section className="space-y-2.5">
          <h2 className="text-xs font-semibold">{m['ui.remix.material']()}</h2>
          <p className="text-[11px] leading-4 text-[var(--vh-text-3)]">{m['ui.remix.material_hint']()}</p>
          <AssetChoiceGrid assets={visuals.filter(asset => asset.id !== reference)} selected={materials} label={m['ui.remix.material']()} onToggle={toggle} />
        </section>
        <section className="space-y-3">
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={keepSoundtrack} onChange={event => setKeepSoundtrack(event.target.checked)} className="size-4 accent-[var(--vh-graph)]" />{m['ui.remix.keep_soundtrack']()}</label>
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={keepCamera} onChange={event => setKeepCamera(event.target.checked)} className="size-4 accent-[var(--vh-graph)]" />{m['ui.remix.keep_camera']()}</label>
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={keepText} disabled={remix?.grammar?.edit?.text === 'unavailable'} onChange={event => setKeepText(event.target.checked)} className="size-4 accent-[var(--vh-graph)]" />{m['ui.remix.keep_text']()}</label>
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={keepSpeed} onChange={event => setKeepSpeed(event.target.checked)} className="size-4 accent-[var(--vh-graph)]" />{m['ui.remix.keep_speed']()}</label>
          <label className="flex items-center justify-between gap-3 text-xs">{m['ui.cinema.sequence_transition']()}
            <NativeSelect aria-label={m['ui.cinema.sequence_transition']()} value={join} onChange={event => setJoin(event.target.value as TimelineTransitionKind | 'none')} className="h-8 max-w-48 text-xs">
              {JOINS.map(kind => <option key={kind} value={kind}>{TRANSITION_LABELS[kind]()}</option>)}
            </NativeSelect>
          </label>
        </section>
      </aside>
      <div className="min-w-0 space-y-5 p-5 lg:overflow-y-auto sm:p-6">
        {!remix && <div className="rounded-2xl border border-dashed border-[var(--vh-border)] p-10 text-center text-sm text-[var(--vh-text-2)]">{m['ui.remix.empty']()}</div>}
        {remix && !remix.grammar && <p role="status" className="inline-flex items-center gap-2 text-sm text-[var(--vh-text-2)]">
          {remix.error ? <span className="text-red-700">{remix.error}</span> : <><Loader2 className="size-4 animate-spin" />{m['ui.remix.analyzing']()}</>}
        </p>}
        {remix?.grammar && remix.edit && REMIX_RUNNING.has(remix.edit.state) && <p role="status" className="inline-flex items-center gap-2 text-xs text-[var(--vh-text-2)]"><Loader2 className="size-3.5 animate-spin" />{m['ui.remix.reading_edit']()}</p>}
        {remix?.edit?.error && <p role="status" className="text-xs text-amber-700">{m['ui.remix.edit_failed']()}</p>}
        {remix?.grammar?.edit?.text === 'unavailable' && <p className="text-xs text-[var(--vh-text-2)]">{m['ui.remix.text_unavailable']()}</p>}
        {remix?.grammar && <RemixShots remix={remix} plan={plan} urls={new Map(visuals.map(asset => [asset.id, asset.publicUrl]))} />}
        {remix?.grammar && <div className="flex flex-wrap items-center gap-3 border-t border-[var(--vh-border)] pt-4">
          <Action type="button" className="vh-primary inline-flex items-center gap-2" disabled={!chosen.length || build.isPending}
            onClick={() => build.mutate({ requestId: remix.requestId, materials, keepSoundtrack, keepCamera, keepSpeed, keepText: keepText && remix.grammar?.edit?.text === 'read', transition: join === 'none' ? null : { kind: join, duration: 0.4 } })}>
            {build.isPending ? <Loader2 className="size-4 animate-spin" /> : <Repeat2 className="size-4" />}{m['ui.remix.build']()}
          </Action>
          {build.isSuccess && <p role="status" className="text-xs text-emerald-800">{m['ui.remix.built']({ count: build.data.shots.length })} {build.data.soundtrack ? m['ui.remix.built_soundtrack']() : ''} {build.data.cameraMoves || build.data.texts ? m['ui.remix.built_edit']({ moves: build.data.cameraMoves, texts: build.data.texts }) : ''}
            {' '}<Link href={'/editor/' + projectId} className="font-semibold underline underline-offset-4">{m['ui.remix.open_editor']()}</Link></p>}
          {build.isError && <p role="alert" className="text-xs text-red-700">{build.error.message}</p>}
          {analyze.isError && <p role="alert" className="text-xs text-red-700">{analyze.error.message}</p>}
        </div>}
      </div>
    </div>
  </ProductPageShell>;
}
