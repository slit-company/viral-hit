import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { editorOperationSchema } from '../commands/schema';
import { applyEditorOperations } from '../commands/editor-commands';
import { addSourceClip, createTimelineDocument, findTimelineClip, normalizeTimelineDocument, splitTimelineClip, type TimelineDocument } from './timeline-document';
import { TIMELINE_TRANSITION_KINDS, radialMaskAlpha, transitionFrame, type TimelineTransitionKind, type TransitionLayer } from './transition-contract';
import { buildTransitionFilters } from './transition-render.server';
import { listTimelineTransitions, setTimelineTransitionsAtCuts, transitionProgress } from './transitions';

const ffmpeg = process.env.VIRAL_HIT_FFMPEG || 'ffmpeg';

function twoClips(first: 'image' | 'video' = 'image', second: 'image' | 'video' = 'image') {
  let document = createTimelineDocument({ projectId: 'transitions', name: 'Transitions' });
  document = addSourceClip(document, { clipId: 'a', assetId: 'a', sourceUrl: '/a', name: 'A', sourceType: first, sourceDuration: first === 'video' ? 2 : 1 });
  if (first === 'video') document = applyEditorOperations(document, [{ type: 'trim_clip', clipId: 'a', inPoint: 0, outPoint: 1 }]).document;
  return addSourceClip(document, { clipId: 'b', assetId: 'b', sourceUrl: '/b', name: 'B', sourceType: second, sourceDuration: 2, startTime: 1 });
}

test('transitions enter base visuals, clamp to the clip, survive a left split only and stay off other tracks', () => {
  const parsed = editorOperationSchema.parse({ type: 'set_transition', clipId: 'b', transition: { kind: 'wipe-left', duration: 0.6 } });
  let document = applyEditorOperations(twoClips(), [parsed]).document;
  assert.deepEqual(findTimelineClip(document, 'b')?.transition, { kind: 'wipe-left', duration: 0.6 });
  assert.equal(document.duration, 3, 'timing never changes');
  const [span] = listTimelineTransitions(document);
  assert.equal(span.outgoing?.id, 'a');
  assert.ok(Math.abs(transitionProgress(span.incoming, 1.3)! - 0.5) < 1e-9);
  assert.equal(transitionProgress(span.incoming, 1.6), null);
  document = applyEditorOperations(document, [{ type: 'set_transition', clipId: 'b', transition: { kind: 'crossfade', duration: 3 } }]).document;
  assert.equal(findTimelineClip(document, 'b')?.transition?.duration, 2, 'clamped to the incoming clip');
  const split = splitTimelineClip(document, 'b', 1, 'b-right');
  assert.ok(findTimelineClip(split, 'b')?.transition);
  assert.equal(findTimelineClip(split, 'b-right')?.transition, undefined);
  assert.throws(() => editorOperationSchema.parse({ type: 'set_transition', clipId: 'b', transition: { kind: 'spin', duration: 1 } }));
  const audio = addSourceClip(document, { clipId: 'music', assetId: 'm', sourceUrl: '/m', name: 'M', sourceType: 'audio', sourceDuration: 2 });
  assert.throws(() => applyEditorOperations(audio, [{ type: 'set_transition', clipId: 'music', transition: { kind: 'crossfade', duration: 0.5 } }]));
  const raw = JSON.parse(JSON.stringify(audio)) as TimelineDocument;
  raw.tracks.find((track) => track.kind === 'audio')!.clips[0].transition = { kind: 'crossfade', duration: 0.5 };
  assert.throws(() => normalizeTimelineDocument(raw), /base track/);
  const locked = { ...document, tracks: document.tracks.map((track) => (track.kind === 'video' ? { ...track, locked: true } : track)) };
  assert.throws(() => applyEditorOperations(locked, [{ type: 'set_transition', clipId: 'b', transition: null }]));
});

test('apply at every cut skips the opening clip; null clears every base transition', () => {
  let document = addSourceClip(twoClips(), { clipId: 'c', assetId: 'c', sourceUrl: '/c', name: 'C', sourceType: 'image', sourceDuration: 1, startTime: 4 });
  document = setTimelineTransitionsAtCuts(document, { kind: 'slide-left', duration: 0.4 });
  assert.deepEqual(listTimelineTransitions(document).map((span) => span.incoming.id), ['b'], 'c follows a gap, a opens');
  document = applyEditorOperations(document, [{ type: 'set_transition', clipId: 'a', transition: { kind: 'fade-black', duration: 0.5 } }]).document;
  assert.equal(listTimelineTransitions(document)[0].outgoing, null, 'the opening clip enters from black');
  document = applyEditorOperations(document, [{ type: 'set_transitions_at_cuts', transition: null }]).document;
  assert.equal(listTimelineTransitions(document).length, 0);
});

test('frame math starts on the outgoing clip and ends on the incoming clip for every kind', () => {
  for (const kind of TIMELINE_TRANSITION_KINDS) {
    const start = expectedColor(transitionFrame(kind, 0), 40, 24, 80, 48, [255, 0, 0], [0, 0, 255]);
    const end = expectedColor(transitionFrame(kind, 1), 40, 24, 80, 48, [255, 0, 0], [0, 0, 255]);
    assert.ok(start[0] > 240 && start[2] < 15, `${kind} start ${start}`);
    assert.ok(end[2] > 240 && end[0] < 15, `${kind} end ${end}`);
  }
});

type Rgb = [number, number, number];

function coverage(layer: TransitionLayer, x: number, y: number, width: number, height: number) {
  const px = x + 0.5 - layer.dx * width;
  const py = y + 0.5 - layer.dy * height;
  if (px < 0 || px >= width || py < 0 || py >= height) return 0;
  const { mask } = layer;
  if (mask.kind === 'rect' && (x + 0.5 < mask.left * width || x + 0.5 > width - mask.right * width || y + 0.5 < mask.top * height || y + 0.5 > height - mask.bottom * height)) return 0;
  if (mask.kind === 'radial') return radialMaskAlpha(mask.offset, Math.hypot(x + 0.5 - width / 2, y + 0.5 - height / 2) / Math.hypot(width / 2, height / 2));
  return 1;
}

/** The browser compositor's result for solid-colour layers. */
function expectedColor(frame: ReturnType<typeof transitionFrame>, x: number, y: number, width: number, height: number, a: Rgb, b: Rgb): Rgb {
  if (frame.blend === 'add') return [0, 1, 2].map((channel) => Math.min(255, frame.outgoing.weight * a[channel] + frame.incoming.weight * b[channel] + frame.white * 255)) as Rgb;
  const under = coverage(frame.outgoing, x, y, width, height);
  const top = coverage(frame.incoming, x, y, width, height);
  return [0, 1, 2].map((channel) => b[channel] * top + a[channel] * under * (1 - top)) as Rgb;
}

test('real FFmpeg xfade segments match the shared frame math for every kind, held frames and incoming in-points', () => {
  const directory = mkdtempSync(join(tmpdir(), 'vh-transition-'));
  try {
    const width = 80, height = 48, fps = 10;
    const make = (args: string[]) => execFileSync(ffmpeg, ['-v', 'error', '-y', ...args]);
    make(['-f', 'lavfi', '-i', `color=red:s=${width}x${height}`, '-frames:v', '1', join(directory, 'red.png')]);
    make(['-f', 'lavfi', '-i', `color=blue:s=${width}x${height}`, '-frames:v', '1', join(directory, 'blue.png')]);
    // Red for one second, then lime: a held last frame at 1 s must stay red; a 1 s in-point must start lime.
    make(['-f', 'lavfi', '-i', `color=red:s=${width}x${height}:r=${fps}:d=1`, '-f', 'lavfi', '-i', `color=lime:s=${width}x${height}:r=${fps}:d=1`,
      '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0,format=yuv420p', '-c:v', 'libx264', '-g', '1', join(directory, 'red-lime.mp4')]);
    const render = (document: TimelineDocument, sources: Map<string, { filePath: string; sourceType: 'image' | 'video'; inPoint: number; outPoint: number }>) => {
      const built = buildTransitionFilters({ document, sources, firstInputIndex: 1, width, height, visualLabel: '0:v', frameRate: fps });
      assert.equal(built.count, 1);
      return execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', `color=black:s=${width}x${height}:r=${fps}:d=3`, ...built.inputArgs,
        '-filter_complex', built.filters.join(';'), '-map', `[${built.output}]`, '-frames:v', '30', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'], { maxBuffer: 16 * 1024 * 1024 });
    };
    const pixel = (raw: Buffer, frame: number, x: number, y: number) => [...raw.subarray(((frame * height + y) * width + x) * 3, ((frame * height + y) * width + x) * 3 + 3)];
    const images = new Map([['a', { filePath: join(directory, 'red.png'), sourceType: 'image' as const, inPoint: 0, outPoint: 1 }], ['b', { filePath: join(directory, 'blue.png'), sourceType: 'image' as const, inPoint: 0, outPoint: 2 }]]);
    for (const kind of TIMELINE_TRANSITION_KINDS) {
      const document = applyEditorOperations(twoClips(), [{ type: 'set_transition', clipId: 'b', transition: { kind, duration: 1 } }]).document;
      const raw = render(document, images);
      for (const step of [2, 4, 6, 8]) {
        const frame = transitionFrame(kind as TimelineTransitionKind, step / 10);
        for (const [x, y] of [[6, 6], [40, 24], [73, 41], [20, 40], [60, 8]]) {
          const nearby = [[0, 0], [3, 0], [-3, 0], [0, 3], [0, -3]].map(([dx, dy]) => expectedColor(frame, x + dx, y + dy, width, height, [255, 0, 0], [0, 0, 255]));
          if (nearby.some((color) => color.some((value, channel) => Math.abs(value - nearby[0][channel]) > 40))) continue;
          const actual = pixel(raw, 10 + step, x, y);
          assert.ok(actual.every((value, channel) => Math.abs(value - nearby[0][channel]) <= 16), `${kind} p=${step / 10} at ${x},${y}: ${actual} vs ${nearby[0].map(Math.round)}`);
        }
      }
    }
    const video = twoClips('video', 'video');
    const crossfade = applyEditorOperations(video, [{ type: 'set_transition', clipId: 'b', transition: { kind: 'crossfade', duration: 1 } }]).document;
    const raw = render(crossfade, new Map([
      ['a', { filePath: join(directory, 'red-lime.mp4'), sourceType: 'video', inPoint: 0, outPoint: 1 }],
      ['b', { filePath: join(directory, 'red-lime.mp4'), sourceType: 'video', inPoint: 1, outPoint: 2 }],
    ]));
    const early = pixel(raw, 11, 40, 24), late = pixel(raw, 19, 40, 24);
    assert.ok(early[0] > 200 && early[1] < 60, `held red frame leads: ${early}`);
    assert.ok(late[1] > 200 && late[0] < 60, `incoming starts at its in-point: ${late}`);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
