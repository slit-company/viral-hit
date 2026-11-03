import { time, type RenderInput } from './timeline-render-inputs.server';
import type { TimelineDocument } from './timeline-document';
import { duckingExpression, voiceIntervals } from './audio-ducking';

/**
 * One mixed audio stream padded to the timeline length, or null when no selected clip is audible.
 * Clips outside `include` stay in the mix at zero gain: amix scales by the number of inputs, so
 * every partial mix keeps the full mix's levels and the partial mixes add up to it exactly.
 */
export function buildAudioMix({ inputs, document, include = () => true, label = 'aout' }: {
  inputs: readonly RenderInput[]; document: TimelineDocument; include?: (input: RenderInput) => boolean; label?: string;
}) {
  const audible = inputs.filter((item) => item.probe.hasAudio && !item.clip.muted);
  if (!audible.some(include)) return null;
  const filters: string[] = [];
  const labels: string[] = [];
  const voices = voiceIntervals(document);
  for (const input of audible) {
    const name = `${label}in${labels.length + 1}`;
    const steps = [
      `atrim=start=${time(input.source.inPoint)}:end=${time(input.source.outPoint)}`,
      'asetpts=PTS-STARTPTS',
      `volume=${(include(input) ? Math.max(0, input.clip.volume) : 0).toFixed(3)}`,
    ];
    const duck = input.clip.ducking && duckingExpression(voices, input.clip.ducking, input.clip.startTime, input.clip.duration);
    if (duck) steps.push(`volume='${duck}':eval=frame`);
    if (input.clip.fadeIn > 0) steps.push(`afade=t=in:st=0:d=${time(input.clip.fadeIn)}`);
    if (input.clip.fadeOut > 0) steps.push(`afade=t=out:st=${time(input.clip.duration - input.clip.fadeOut)}:d=${time(input.clip.fadeOut)}`);
    steps.push(`adelay=${Math.round(input.clip.startTime * 1000)}:all=1`);
    filters.push(`[${input.inputIndex}:a]${steps.join(',')}[${name}]`);
    labels.push(`[${name}]`);
  }
  filters.push(
    `${labels.join('')}amix=inputs=${labels.length}:duration=longest:dropout_transition=0,` +
      `atrim=duration=${time(document.duration)},apad=whole_dur=${time(document.duration)}[${label}]`
  );
  return { filters, label };
}
