import { useEffect, useRef, useState } from 'react';
import { Action } from '@/components/base/action';
import { readSceneOutput } from '@/core/references/scene-contract';

export function SceneResult({ projectId, output }: { projectId: string; output: string | null }) {
  const result = readSceneOutput(output), [selected, setSelected] = useState(0), [failed, setFailed] = useState(false);
  const player = useRef<HTMLVideoElement>(null);
  const scene = result?.analysis.scenes[selected] ?? result?.analysis.scenes[0];
  const seek = () => { if (player.current && player.current.readyState >= 1 && scene) player.current.currentTime = scene.start; };
  useEffect(() => { setFailed(false); seek(); }, [result?.assetId, scene?.start]);
  if (!result || result.projectId !== projectId || !scene) return null;
  const omitted = result.analysis.candidateCount - result.analysis.scenes.length + 1;
  return <section aria-label="Detected visual scenes" className="mt-3 space-y-3 border-t border-[var(--vh-border)] pt-3">
    <p className="font-medium">{result.analysis.scenes.length} editable scenes · {result.analysis.duration.toFixed(2)}s</p>
    <p className="text-xs leading-5 text-[var(--vh-text-2)]">Visual changes sampled at 8 fps. Flashes, motion and fades can create extra or missed cuts.</p>
    {omitted > 0 && <p className="text-xs text-[var(--vh-text-2)]">{omitted} weaker or closely spaced transitions merged. The full source interval is retained.</p>}
    <video ref={player} key={result.assetId} controls playsInline preload="metadata" className="max-h-40 w-full rounded-xl bg-black" aria-label="Scene preview"
      src={`/api/app/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(result.assetId)}`} onLoadedMetadata={seek} onError={() => setFailed(true)}
      onPlay={() => { if (player.current && (player.current.currentTime < scene.start || player.current.currentTime >= scene.end)) seek(); }}
      onTimeUpdate={() => { if (player.current && player.current.currentTime >= scene.end) player.current.pause(); }} />
    {failed && <p role="alert">Source preview could not load. Verify the original project video before editing.</p>}
    <p className="text-xs tabular-nums">Selected range: {scene.start.toFixed(3)}–{scene.end.toFixed(3)} seconds</p>
    <div className="grid max-h-44 grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3" aria-label="Scene ranges">
      {result.analysis.scenes.map((item, index) => <Action key={item.start} aria-label={`Preview scene ${index + 1}`} aria-pressed={selected === index} className={'h-auto! min-w-0 rounded-lg! flex-col! items-start! px-2! py-2! text-left! ' + (selected === index ? 'vh-primary' : 'vh-secondary')} onClick={() => { player.current?.pause(); setSelected(index); }}>
        <span className="text-xs font-semibold">Scene {index + 1}</span><span className="text-[10px] tabular-nums">{item.start.toFixed(2)}–{item.end.toFixed(2)}s</span>
      </Action>)}
    </div>
    <p className="text-xs text-[var(--vh-text-2)]">Review detected timings before editing. The original video and audio are preserved.</p>
  </section>;
}
