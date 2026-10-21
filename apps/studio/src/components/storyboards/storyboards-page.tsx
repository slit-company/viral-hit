import { AnalysisImport } from './analysis-import';
import { useState } from 'react';
import { Action } from '@/components/base/action';
import { ProductShell } from '@/components/marketing/product-shell';
import { HarnessDialog } from '@/components/app/harness-dialog';
import { Link } from '@/core/i18n/navigation';
import { useStoryboards } from './use-storyboards';
import { downloadDraft, newShot } from './draft';
import { panel, SelectField } from './fields';
import { ReferenceImport } from './reference-import';
import { PlanContext } from './plan-context';
import { ShotEditor } from './shot-editor';

export function StoryboardsPage({ projectId, locale }: { projectId: string; locale: string }) {
  const c = useStoryboards(projectId);
  const [tab, setTab] = useState<'shots' | 'plan'>('shots'), [selectedId, setSelectedId] = useState('');
  const plan = c.draft?.plan;
  const selected = plan?.shots.find(shot => shot.id === selectedId) ?? plan?.shots[0];
  const index = plan?.shots.findIndex(shot => shot.id === selected?.id) ?? 0;
  const accepted = Object.keys(c.view?.accepted ?? {}).length;
  function move(direction: number) {
    if (!plan || !selected) return;
    const shots = [...plan.shots], target = index + direction;
    if (target < 0 || target >= shots.length) return;
    [shots[index], shots[target]] = [shots[target], shots[index]];
    c.update({ ...plan, shots });
  }
  return <ProductShell locale={locale} active="projects"><main className="mx-auto w-full max-w-[1240px] space-y-6 px-5 pb-16 pt-10 sm:px-6">
    <header className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><Link href={'/editor/' + projectId} className="text-sm underline underline-offset-4">Open project editor</Link><HarnessDialog projectId={projectId} /></div>
      <p className="text-[11px] font-semibold tracking-[0.18em] text-[var(--vh-accent)]">STORYBOARDS</p>
      <h1 className="vh-product-display break-words text-[clamp(2rem,4vw,3rem)] font-semibold leading-[1.1] tracking-[-0.04em]">Make every shot intentional.</h1>
      <p className="max-w-2xl text-sm leading-6 text-[var(--vh-text-2)]">Plan a sequence, choose any compatible recipe, review each result and assemble editable shots. General films and specific creative jobs use the same workflow.</p>
    </header>
    <div className="flex flex-wrap items-end gap-3">
      <div className="min-w-0 flex-1 basis-64"><SelectField label="Project storyboards" value={c.view?.id ?? ''} onChange={id => { if (id) void c.open(id); }}><option value="">Choose a saved storyboard…</option>{c.catalog?.boards.map(board => <option key={board.id} value={board.id} disabled={c.dirty || !!c.pending || c.busy}>{board.title} · {board.id} · r{board.revision}</option>)}</SelectField></div>
      <Action className="vh-secondary" disabled={!c.catalog || c.busy || c.dirty || !!c.pending} onClick={() => { c.create(); setTab('plan'); }}>New storyboard</Action>
      <Action className="vh-secondary" disabled={c.busy} onClick={() => void c.refresh()}>Refresh status</Action>
    </div>
    <ReferenceImport controller={c} onPrepared={() => setTab('plan')} />
    <AnalysisImport controller={c} onPrepared={() => setTab('plan')} />
    {!c.catalog && <p role="status">Loading project storyboards…</p>}
    {c.error && <p role="alert" className="whitespace-pre-wrap break-words rounded-xl bg-red-500/10 p-4 text-sm text-red-800">{c.error}</p>}
    {c.notice && <p role="status" className="break-words rounded-xl bg-[var(--color-brand-lime-soft)] p-4 text-sm leading-6 text-[var(--color-lime-text)]">{c.notice}</p>}
    {c.pending && <section className="space-y-3 rounded-xl bg-amber-100 p-4 text-sm text-amber-950" aria-label="Pending storyboard request"><p>An execution response is unresolved. Recover the same request before starting another attempt.</p><p className="break-all font-mono text-xs">{c.pending.id} · {c.pending.requestId}</p><Action className="vh-secondary" disabled={c.busy} onClick={() => void c.recover()}>Recover same request</Action></section>}
    {!plan && c.catalog && <section className={panel}><h2 className="text-lg font-semibold">Start with a plan.</h2><p className="text-sm leading-6 text-[var(--vh-text-2)]">Create a storyboard or open one authored by an agent. Import source media in the project editor, then refresh here to use it for references, shots or audio.</p></section>}
    {plan && c.catalog && c.draft && <>
      <section className={panel} aria-label="Storyboard status">
        <div className="flex flex-wrap justify-between gap-4"><div className="min-w-0 space-y-2"><h2 className="break-words text-xl font-semibold">{plan.title || 'Untitled storyboard'}</h2><p className="break-all font-mono text-xs text-[var(--vh-text-2)]">{c.draft.id} · {c.draft.revision ? 'Revision ' + c.draft.revision : 'New draft'}{c.dirty ? ' · Unsaved plan' : ' · Saved'}</p><p className="text-sm">{plan.shots.length} shots · {Number(plan.shots.reduce((sum, shot) => sum + shot.duration, 0).toFixed(2))} seconds · {accepted} accepted in saved plan</p></div>
          <div className="flex flex-wrap items-start gap-2"><Action className="vh-primary" disabled={c.busy || !c.dirty || c.stale || !!c.pending} onClick={() => void c.save()}>Save plan</Action><Action className="vh-secondary" disabled={c.busy} onClick={() => downloadDraft(c.draft!)}>Download draft</Action>{c.dirty && <Action className="vh-secondary" disabled={c.busy || !!c.pending} onClick={c.useServer}>Discard local changes</Action>}</div></div>
        {c.stale && <div role="alert" className="space-y-3 rounded-xl bg-amber-100 p-4 text-sm text-amber-950"><p>The server is at revision {c.view!.revision}. Your local plan is preserved. Review the current server plan before replacing it.</p><details><summary className="cursor-pointer">Compare server plan</summary><pre aria-label="Current server plan" className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(c.view!.plan, null, 2)}</pre></details><Action className="vh-secondary" disabled={c.busy || !!c.pending} onClick={() => void c.save(true)}>Save my plan over revision {c.view!.revision}</Action></div>}
      </section>
      <div role="group" aria-label="Storyboard workspace" className="flex gap-3"><Action className={tab === 'plan' ? 'vh-primary' : 'vh-secondary'} aria-pressed={tab === 'plan'} onClick={() => setTab('plan')}>Plan & references</Action><Action className={tab === 'shots' ? 'vh-primary' : 'vh-secondary'} aria-pressed={tab === 'shots'} onClick={() => setTab('shots')}>Shots & results</Action></div>
      <fieldset disabled={c.busy} className="min-w-0">
        {tab === 'plan' ? <PlanContext plan={plan} assets={c.catalog.assets} change={c.update} /> : <div className="grid items-start gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
          <aside className={panel} aria-label="Shot order"><h2 className="font-semibold">Sequence</h2><ol className="space-y-2">{plan.shots.map((shot, i) => <li key={shot.id}><Action aria-pressed={selected?.id === shot.id} aria-label={'Select shot ' + (i + 1) + ': ' + shot.title} className={'h-auto! w-full justify-start! rounded-xl! px-3! py-3! text-left! ' + (selected?.id === shot.id ? 'vh-primary' : 'vh-secondary')} onClick={() => setSelectedId(shot.id)}><span className="shrink-0 font-mono text-xs">{String(i + 1).padStart(2, '0')}</span><span className="min-w-0 flex-1"><span className="block break-words">{shot.title || 'Untitled shot'}</span><span className="mt-1 block text-xs font-normal">{shot.duration}s · {c.view?.accepted[shot.id] ? 'Accepted in saved plan' : 'Needs review'}</span></span></Action></li>)}</ol>
            <Action className="vh-secondary w-full" disabled={plan.shots.length >= 16} onClick={() => { const shot = newShot(); c.update({ ...plan, shots: [...plan.shots, shot] }); setSelectedId(shot.id); }}>Add shot</Action>
            <div className="flex flex-wrap gap-2"><Action className="vh-secondary" disabled={index === 0} onClick={() => move(-1)}>Move up</Action><Action className="vh-secondary" disabled={index === plan.shots.length - 1} onClick={() => move(1)}>Move down</Action><Action className="vh-secondary" disabled={plan.shots.length === 1} onClick={() => c.update({ ...plan, shots: plan.shots.filter(shot => shot.id !== selected?.id) })}>Remove shot</Action></div>
          </aside>
          {selected && <ShotEditor key={c.draft.id + ':' + selected.id} controller={c} projectId={projectId} shot={selected} index={index} />}
        </div>}
      </fieldset>
      <section className={panel} aria-label="Assemble storyboard"><h2 className="text-lg font-semibold">Bring the sequence into your edit.</h2><p className="text-sm leading-6 text-[var(--vh-text-2)]">Accept every shot, then prepare an editable sequence. In Generation runs, add the completed sequence to your timeline. Existing edits stay in place.</p><Action className="vh-primary" disabled={c.busy || c.dirty || !!c.pending || accepted !== plan.shots.length} onClick={() => void c.assemble()}>Prepare editable sequence</Action>
        {c.view?.actions.filter(action => action.kind === 'assemble').map(action => <div key={action.requestId} className="space-y-1 border-t border-[var(--vh-border)] pt-3 text-xs"><p className="break-all font-mono">Revision {action.revision} · {action.runId ?? action.requestId}</p>{action.jobs.map(job => <p key={job.id} className="break-words">{job.nodeId}: {job.state}{job.error ? ' · ' + job.error : ''}</p>)}</div>)}
      </section>
    </>}
  </main></ProductShell>;
}
