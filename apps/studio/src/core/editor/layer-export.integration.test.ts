import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';

const directory = await mkdtemp(join(tmpdir(), 'vh-layers-test-'));
process.env.VIRAL_HIT_DATA_DIR = directory;
delete process.env.VIRAL_HIT_HARNESS_DB;
execFileSync('pnpm', ['exec', 'drizzle-kit', 'push', '--force'], { env: process.env, stdio: 'pipe' });
after(async () => rm(directory, { recursive: true, force: true }));
const ffmpeg = process.env.VIRAL_HIT_FFMPEG || 'ffmpeg';
const ffprobe = process.env.VIRAL_HIT_FFPROBE || 'ffprobe';
const { createProject } = await import('../projects/projects');
const { importLocalProjectAsset } = await import('../projects/import-local-asset');
const { createTimelineDocument } = await import('./timeline-document');
const { appendSequence, sequenceSchema } = await import('./sequence');
const { setTimelineTransitionsAtCuts } = await import('./transitions');
const { setCaptionHighlight } = await import('./caption-word-ops');
const { renderTimelineLayers, zipTimelineLayers } = await import('./layer-export.server');
const { buildFfmpegArgs } = await import('./render-project-timeline');
const { resolveRenderInputs } = await import('./timeline-render-inputs.server');

const make = (name: string, args: string[]) => {
  const file = join(directory, name);
  execFileSync(ffmpeg, ['-v', 'error', ...args, file]);
  return file;
};
const media = {
  red: make('red.mp4', ['-f', 'lavfi', '-i', 'color=red:s=160x90:r=30:d=2', '-f', 'lavfi', '-i', 'sine=frequency=880:duration=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest']),
  blue: make('blue.mp4', ['-f', 'lavfi', '-i', 'color=blue:s=160x90:r=30:d=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p']),
  badge: make('badge.png', ['-f', 'lavfi', '-i', 'color=white:s=40x40', '-frames:v', '1']),
  voice: make('voice.wav', ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=1']),
  music: make('music.wav', ['-f', 'lavfi', '-i', 'sine=frequency=220:duration=4']),
};
const probe = (file: string) => JSON.parse(execFileSync(ffprobe, ['-v', 'error', '-show_entries', 'stream=codec_type,pix_fmt,width,height:format=duration', '-of', 'json', file], { encoding: 'utf8' })) as {
  streams: Array<{ codec_type: string; pix_fmt?: string; width?: number; height?: number }>; format: { duration: string };
};
const WIDTH = 1920, HEIGHT = 1080;
const frame = (file: string, at: number) => execFileSync(ffmpeg, ['-v', 'error', '-ss', String(at), '-i', file, '-frames:v', '1', '-pix_fmt', 'rgba', '-f', 'rawvideo', '-'], { maxBuffer: 64 * 1024 * 1024 });
const pixel = (raw: Buffer, x: number, y: number) => [...raw.subarray((y * WIDTH + x) * 4, (y * WIDTH + x) * 4 + 4)];
const samples = (file: string, at: number, seconds = 0.3) => {
  const raw = execFileSync(ffmpeg, ['-v', 'error', '-ss', String(at), '-t', String(seconds), '-i', file, '-ac', '1', '-ar', '48000', '-f', 'f32le', '-'], { maxBuffer: 16 * 1024 * 1024 });
  return Array.from({ length: raw.length / 4 }, (_, index) => raw.readFloatLE(index * 4));
};
const rms = (values: readonly number[]) => Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / Math.max(1, values.length));

async function layeredTimeline() {
  const project = await createProject({ name: 'Layer export' });
  const assets: Record<string, { assetId: string; kind: 'image' | 'video' | 'audio' }> = {};
  const library: Record<string, { assetId: string; kind: 'image' | 'video' | 'audio'; publicUrl: string; name: string; duration: number | null }> = {};
  for (const [key, kind, duration] of [['red', 'video', 2], ['blue', 'video', 2], ['badge', 'image', null], ['voice', 'audio', 1], ['music', 'audio', 4]] as const) {
    const imported = await importLocalProjectAsset({ projectId: project.id, filePath: media[key] });
    assets[key] = { assetId: imported.id, kind };
    library[key] = { assetId: imported.id, kind, publicUrl: imported.publicUrl, name: key, duration };
  }
  const sequence = sequenceSchema.parse({
    schemaVersion: 1, title: 'Layers', assets,
    tracks: [
      { id: 'base', kind: 'video', name: 'Base', clips: [
        { id: 'red', type: 'media', source: 'red', startTime: 0, duration: 2 },
        { id: 'blue', type: 'media', source: 'blue', startTime: 2, duration: 2 },
      ] },
      { id: 'badge', kind: 'overlay', name: 'Badge', clips: [
        { id: 'badge', type: 'media', source: 'badge', startTime: 1, duration: 2, overlay: { x: 0.5, y: 0.5, width: 0.25, opacity: 0.5, rotation: 0 } },
      ] },
      { id: 'voice', kind: 'audio', name: 'Voice', clips: [{ id: 'voice', type: 'media', source: 'voice', startTime: 1, duration: 1, audioRole: 'voice' }] },
      { id: 'music', kind: 'audio', name: 'Music', clips: [{ id: 'music', type: 'media', source: 'music', startTime: 0, duration: 4, audioRole: 'music' }] },
      { id: 'captions', kind: 'caption', name: 'Captions', clips: [{ id: 'cue', type: 'caption', text: 'Stack every layer', startTime: 0.5, duration: 3 }] },
    ],
  });
  let document = appendSequence(createTimelineDocument({ projectId: project.id, name: 'Layers' }), sequence, library, 'qa');
  document = setTimelineTransitionsAtCuts(document, { kind: 'crossfade', duration: 0.5 });
  return { projectId: project.id, document: setCaptionHighlight(document, '#FFD60A') };
}

test('layer export splits a real timeline into stackable picture, transparent overlay and caption layers, SRT and audio stems', async () => {
  const { projectId, document } = await layeredTimeline();
  assert.equal(document.duration, 4);
  const output = join(directory, 'layers'); await mkdir(output);
  const files = await renderTimelineLayers({ projectId, document, directory: output });
  assert.deepEqual(files.map((file) => file.name), ['picture.mp4', 'overlays.mov', 'captions.mov', 'captions.srt', 'audio-voice.wav', 'audio-music.wav', 'audio-source.wav']);
  const path = (name: string) => join(output, name);

  for (const name of ['picture.mp4', 'overlays.mov', 'captions.mov', 'audio-voice.wav', 'audio-music.wav', 'audio-source.wav']) {
    const info = probe(path(name));
    assert.ok(Math.abs(Number(info.format.duration) - 4) < 0.05, `${name} lasts the whole timeline: ${info.format.duration}`);
    const visual = info.streams.find((stream) => stream.codec_type === 'video');
    if (name.endsWith('.wav')) { assert.equal(visual, undefined); continue; }
    assert.deepEqual([visual?.width, visual?.height], [WIDTH, HEIGHT], name);
    assert.equal(info.streams.some((stream) => stream.codec_type === 'audio'), false, `${name} carries no sound`);
    assert.equal(visual?.pix_fmt, name.endsWith('.mov') ? 'argb' : 'yuv420p', name);
  }

  // Picture: base clips and the crossfade, without the badge on top.
  const red = pixel(frame(path('picture.mp4'), 1.5), WIDTH / 2, HEIGHT / 2);
  assert.ok(red[0] > 200 && red[1] < 40 && red[2] < 40, `badge stays out of the picture layer: ${red}`);
  const mid = pixel(frame(path('picture.mp4'), 2.25), WIDTH / 2, HEIGHT / 2);
  assert.ok(mid[0] > 60 && mid[2] > 60, `crossfade blends red into blue: ${mid}`);
  const blue = pixel(frame(path('picture.mp4'), 3.5), WIDTH / 2, HEIGHT / 2);
  assert.ok(blue[2] > 200 && blue[0] < 40, `blue after the cut: ${blue}`);

  // Overlays: the half-opaque badge keeps straight alpha (full white at alpha 0.5) and nothing else.
  const badge = frame(path('overlays.mov'), 1.5);
  const [r, g, b, a] = pixel(badge, WIDTH / 2, HEIGHT / 2);
  assert.ok(Math.min(r, g, b) > 240 && Math.abs(a - 128) < 12, `straight-alpha badge: ${[r, g, b, a]}`);
  assert.equal(pixel(badge, 10, 10)[3], 0, 'transparent around the badge');
  assert.equal(pixel(frame(path('overlays.mov'), 0.5), WIDTH / 2, HEIGHT / 2)[3], 0, 'badge hidden before it starts');

  // Captions: transparent until the cue, then exact white text, the spoken-word highlight and a semi-opaque outline.
  assert.ok(frame(path('captions.mov'), 0.2).every((value, index) => index % 4 !== 3 || value === 0), 'no caption before 0.5 s');
  const caption = frame(path('captions.mov'), 2);
  const pixels = Array.from({ length: WIDTH * HEIGHT }, (_, index) => [...caption.subarray(index * 4, index * 4 + 4)]);
  const opaque = pixels.filter((value) => value[3] === 255);
  assert.ok(opaque.some(([red, green, blue]) => Math.min(red, green, blue) >= 250), 'white text stays full white');
  assert.ok(opaque.some(([red, green, blue]) => red > 240 && green > 190 && blue < 60), 'spoken word highlighted');
  assert.ok(pixels.some(([red, green, blue, alpha]) => alpha > 160 && alpha < 200 && Math.max(red, green, blue) < 30), 'outline keeps its 72% opacity');
  assert.equal(pixel(caption, WIDTH / 2, HEIGHT / 2)[3], 0, 'transparent away from the text');

  assert.equal(await readFile(path('captions.srt'), 'utf8'), '1\n00:00:00,500 --> 00:00:03,500\nStack every layer\n');

  // Stems: each role sounds only where its clips play, and together they rebuild the flattened mix.
  assert.ok(rms(samples(path('audio-voice.wav'), 0.2)) < 1e-4 && rms(samples(path('audio-voice.wav'), 1.3)) > 0.01, 'voice from 1 s');
  assert.ok(rms(samples(path('audio-music.wav'), 0.2)) > 0.01, 'music from the start');
  assert.ok(rms(samples(path('audio-source.wav'), 0.2)) > 0.01 && rms(samples(path('audio-source.wav'), 3)) < 1e-4, 'source sound only under the red clip');
  const flat = join(directory, 'flat.mp4');
  const plan = await buildFfmpegArgs({ document, inputs: await resolveRenderInputs({ projectId, document }), directory: output, outputPath: flat });
  execFileSync(ffmpeg, plan.args);
  const mix = samples(flat, 1.3);
  const stems = ['voice', 'music', 'source'].map((role) => samples(path(`audio-${role}.wav`), 1.3));
  const summed = mix.map((_, index) => stems.reduce((sum, stem) => sum + (stem[index] ?? 0), 0));
  const residual = rms(mix.map((value, index) => value - summed[index]));
  assert.ok(residual < rms(mix) * 0.1, `stems add up to the flattened mix: residual ${residual} vs ${rms(mix)}`);

  const zipPath = join(directory, 'layers.zip');
  await zipTimelineLayers(files, zipPath, 'Layers');
  const zip = await JSZip.loadAsync(await readFile(zipPath));
  assert.deepEqual(Object.keys(zip.files).sort(), [...files.map((file) => file.name), 'README.txt'].sort());
  const readme = await zip.file('README.txt')!.async('string');
  for (const file of files) assert.ok(readme.includes(file.name), file.name);
  assert.equal((await zip.file('captions.srt')!.async('string')), await readFile(path('captions.srt'), 'utf8'));
});

test('captions without word highlighting keep exact colours and border opacity on the transparent layer', async () => {
  const { projectId, document: highlighted } = await layeredTimeline();
  const document = setCaptionHighlight(highlighted, null);
  const output = join(directory, 'plain-captions'); await mkdir(output);
  const plan = await buildFfmpegArgs({ document, inputs: await resolveRenderInputs({ projectId, document }), directory: output, outputPath: join(output, 'captions.mov'), layer: 'captions' });
  execFileSync(ffmpeg, plan.args);
  const caption = frame(join(output, 'captions.mov'), 2);
  const pixels = Array.from({ length: WIDTH * HEIGHT }, (_, index) => [...caption.subarray(index * 4, index * 4 + 4)]);
  assert.ok(pixels.some(([red, green, blue, alpha]) => alpha === 255 && Math.min(red, green, blue) >= 250), 'white text stays full white');
  assert.ok(pixels.some(([red, green, blue, alpha]) => alpha > 215 && alpha < 245 && Math.max(red, green, blue) < 30), 'border keeps its 90% opacity');
  assert.equal(pixels.filter(([, , , alpha]) => alpha > 0).length < WIDTH * HEIGHT * 0.05, true, 'everything else stays transparent');
});
