import { Action } from '@/components/base/action';
import type { StoryboardShot } from '@/core/storyboards/contract';
import type { StoryboardController } from './use-storyboards';
import { Field, seconds, panel } from './fields';
import { ShotRecipe } from './shot-recipe';
import { ShotReview } from './shot-review';

export function ShotEditor({ controller: c, projectId, shot, index }: { controller: StoryboardController; projectId: string; shot: StoryboardShot; index: number }) {
  const plan = c.draft!.plan;
  const change = (next: StoryboardShot) => c.update({ ...plan, shots: plan.shots.map(item => item.id === shot.id ? next : item) });
  return <section className={panel} aria-label={'Edit shot ' + (index + 1)}>
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">Shot {String(index + 1).padStart(2, '0')}</h2><span className="break-all font-mono text-xs text-[var(--vh-text-2)]">{shot.id}</span></div>
    <Field label="Shot title" value={shot.title} maxLength={120} onChange={title => change({ ...shot, title })} />
    <Field label="Shot duration (seconds)" numeric min={.01} value={shot.duration} onChange={value => change({ ...shot, duration: seconds(value, .01) })} />
    <Field label="Shot direction" value={shot.direction} multiline onChange={direction => change({ ...shot, direction })} />
    <details className="space-y-4 text-sm"><summary className="cursor-pointer font-medium">References & creative decisions</summary>
      {plan.references.map(ref => <label key={ref.id} className="flex items-start gap-3"><input type="checkbox" className="mt-1" checked={shot.references.includes(ref.id)} onChange={event => change({ ...shot, references: event.target.checked ? [...shot.references, ref.id] : shot.references.filter(id => id !== ref.id) })} /><span className="min-w-0 break-words">{ref.observation || 'New observation'}<span className="block break-all text-xs text-[var(--vh-text-2)]">{ref.id} · {ref.basis}</span></span></label>)}
      {!plan.references.length && <p className="text-xs text-[var(--vh-text-2)]">Add a reference observation in the plan, then assign it here.</p>}
      {(['preserve', 'change', 'avoid'] as const).map(key => <Field key={key} label={key === 'preserve' ? 'Preserve (one per line)' : key === 'change' ? 'Change (one per line)' : 'Avoid (one per line)'} multiline value={shot[key].join('\n')} onChange={value => change({ ...shot, [key]: value.split('\n') })} />)}
    </details>
    <Field label="Shot caption" value={shot.caption} multiline onChange={caption => change({ ...shot, caption })} />
    <ShotRecipe projectId={projectId} shot={shot} catalog={c.catalog!.recipes} assets={c.catalog!.assets} capabilities={c.catalog!.capabilities} change={change} />
    {shot.recipe && <Action className="vh-primary" disabled={c.busy || c.dirty || !!c.pending || c.catalog!.recipes.recipeDigests[shot.recipe.id] !== shot.recipe.digest} onClick={() => void c.generate(shot.id)}>Generate new attempt</Action>}
    {c.dirty && <p className="text-xs text-[var(--vh-text-2)]">Save this plan before generating or accepting a result.</p>}
    <ShotReview key={shot.id} controller={c} shotId={shot.id} />
  </section>;
}
