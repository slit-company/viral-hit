import { useRef } from 'react';
import { Action } from '@/components/base/action';
import { m } from '@/paraglide/messages.js';
import type { RemixAssignment, RemixShot, RemixView } from '@/core/remix/contract';
import { cn } from '@/lib/utils';

const CAMERA = { 'zoom-in': () => m['ui.remix.camera_zoom_in'](), 'zoom-out': () => m['ui.remix.camera_zoom_out'](), 'pan-left': () => m['ui.remix.camera_pan_left'](), 'pan-right': () => m['ui.remix.camera_pan_right'](), 'tilt-up': () => m['ui.remix.camera_tilt_up'](), 'tilt-down': () => m['ui.remix.camera_tilt_down'](), handheld: () => m['ui.remix.camera_handheld'](), static: null } as const;
/** What the edit analysis saw in a shot: its camera move, pace changes and the first on-screen text. */
function shotTraits(shot: RemixShot) {
  const traits = [shot.camera && CAMERA[shot.camera.kind]?.(), shot.speed?.freezes.length ? m['ui.remix.freeze']() : null,
    shot.speed?.ramp === 'up' ? m['ui.remix.speeds_up']() : shot.speed?.ramp === 'down' ? m['ui.remix.slows_down']() : null].flatMap(value => value ? [String(value)] : []);
  return { traits, text: shot.text?.[0]?.replace(/\s+/g, ' ') ?? null };
}

/** The reference's rhythm: one bar per shot, sized by its length, with the material it will get. */
export function RemixShots({ remix, plan, urls }: { remix: RemixView; plan: RemixAssignment[] | null; urls: ReadonlyMap<string, string> }) {
  const player = useRef<HTMLVideoElement>(null);
  const grammar = remix.grammar!;
  return <div className="space-y-4">
    <p className="text-sm font-semibold">{m['ui.remix.summary']({ shots: grammar.shots.length, average: grammar.averageShot.toFixed(1), cuts: Math.round(grammar.cutsPerMinute) })}</p>
    {remix.sourceUrl && <video ref={player} src={remix.sourceUrl} controls playsInline preload="metadata" aria-label={remix.sourceName ?? m['ui.remix.reference']()} className="aspect-video w-full max-w-xl rounded-xl bg-black" />}
    <div role="img" aria-label={m['ui.remix.rhythm']()} className="flex h-3 w-full overflow-hidden rounded-full bg-[var(--vh-control)]">
      {grammar.shots.map(shot => <span key={shot.index} className={cn('h-full border-r border-white/70', shot.index % 2 ? 'bg-[var(--vh-graph)]/55' : 'bg-[var(--vh-graph)]')} style={{ width: (shot.duration / grammar.duration) * 100 + '%' }} />)}
    </div>
    <ol className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
      {grammar.shots.map((shot, index) => {
        const assigned = plan?.[index], url = assigned ? urls.get(assigned.material.assetId) : undefined;
        const short = assigned && assigned.length < shot.duration - 0.05, { traits, text } = shotTraits(shot);
        return <li key={shot.index}>
          <Action type="button" onClick={() => { if (player.current) player.current.currentTime = shot.start + 0.01; }}
            className="flex w-full min-w-0 items-center gap-2 rounded-xl border border-[var(--vh-border)] bg-[var(--vh-surface)] p-2 text-left hover:border-[var(--vh-text-3)]">
            <span className="grid size-7 shrink-0 place-items-center rounded-full bg-[var(--vh-control)] text-[11px] font-semibold tabular-nums">{index + 1}</span>
            <span className="relative block h-10 w-16 shrink-0 overflow-hidden rounded-md bg-[var(--vh-control)]">
              {url && (assigned!.material.kind === 'image'
                ? <img src={url} alt="" className="size-full object-cover" />
                : <video src={url + '#t=0.5'} muted preload="metadata" aria-hidden="true" className="size-full object-cover" />)}
            </span>
            <span className="min-w-0 text-[11px] leading-4">
              <span className="block font-semibold tabular-nums">{m['ui.remix.shot_timing']({ start: shot.start.toFixed(2), duration: shot.duration.toFixed(2) })}</span>
              <span className="block truncate text-[var(--vh-text-2)]">{assigned ? assigned.material.name : m['ui.remix.no_material']()}</span>
              {short && <span className="block text-amber-700">{m['ui.remix.short_material']()}</span>}
              {traits.length > 0 && <span className="mt-0.5 flex flex-wrap gap-1">{traits.map(trait => <span key={trait} className="rounded-full bg-[var(--vh-control)] px-1.5 text-[10px] font-medium">{trait}</span>)}</span>}
              {text && <span className="block truncate text-[var(--vh-text-2)]" title={text}>“{text}”</span>}
            </span>
          </Action>
        </li>;
      })}
    </ol>
  </div>;
}
