import type { RemixGrammar, RemixShot } from './contract';
import type { GrammarAnalysis } from './grammar-contract';
import { cameraMove, speedSignals, type MotionSample } from './motion';

const round = (value: number) => Math.round(value * 1000) / 1000;

/** Motion samples wholly inside a shot; the pair that crosses a cut belongs to neither side. */
function shotSamples(motion: GrammarAnalysis['motion'], shot: { start: number; end: number }): MotionSample[] {
  const samples: MotionSample[] = [];
  for (let index = Math.ceil(shot.start * motion.fps - 1e-6); index + 1 <= Math.floor(shot.end * motion.fps + 1e-6) && index < motion.dx.length; index++) {
    samples.push({ dx: motion.dx[index], dy: motion.dy[index], zoom: motion.zoom[index], diff: motion.diff[index] });
  }
  return samples;
}

/**
 * Cut times, pace and shot lengths from a contiguous scene list covering the whole reference, plus each
 * shot's camera move, pace signals and on-screen text when the edit analysis is available.
 */
export function remixGrammar(scenes: readonly { start: number; end: number }[], duration: number, analysis?: GrammarAnalysis | null, readText = true): RemixGrammar {
  const shots: RemixShot[] = scenes.map((scene, index) => ({ index, start: round(scene.start), end: round(scene.end), duration: round(scene.end - scene.start) }));
  const grammar: RemixGrammar = { duration: round(duration), shots, averageShot: round(duration / Math.max(1, shots.length)), cutsPerMinute: round(((shots.length - 1) / Math.max(duration, 0.001)) * 60) };
  if (!analysis) return grammar;
  const { motion, text } = analysis;
  for (const shot of shots) {
    const samples = shotSamples(motion, shot);
    shot.camera = cameraMove(samples, motion.width, motion.height);
    shot.speed = speedSignals(samples, motion.fps, round(Math.ceil(shot.start * motion.fps - 1e-6) / motion.fps));
    shot.text = [...new Set(text.segments.filter(segment => Math.min(segment.end, shot.end) - Math.max(segment.start, shot.start) >= Math.min(0.25, (segment.end - segment.start) / 2)).map(segment => segment.text))].slice(0, 6);
  }
  grammar.edit = { text: !readText ? 'off' : text.engine ? 'read' : 'unavailable', frame: { width: motion.width, height: motion.height },
    texts: text.segments.map(({ start, end, text: value, box, lines }) => ({ start, end, text: value, box, lines })) };
  return grammar;
}

