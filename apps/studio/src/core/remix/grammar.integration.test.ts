import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const directory = await mkdtemp(join(tmpdir(), 'vh-grammar-'));
process.env.VIRAL_HIT_DATA_DIR = directory; delete process.env.VIRAL_HIT_HARNESS_DB;
execFileSync('pnpm', ['exec', 'drizzle-kit', 'push', '--force'], { env: process.env, stdio: 'pipe' });
after(async () => rm(directory, { recursive: true, force: true }));
const ffmpeg = process.env.VIRAL_HIT_FFMPEG || 'ffmpeg';
const { createProject } = await import('../projects/projects');
const { importLocalProjectAsset } = await import('../projects/import-local-asset');
const { openHarness } = await import('../harness/store');
const { createRuntimeAdapters } = await import('../harness/adapters');
const { loadProjectTimeline } = await import('../editor/timeline-state');
const { renderProjectTimelineToAsset } = await import('../editor/render-project-timeline');
const { changeRemix } = await import('./service.server');
const { tesseractEngine } = await import('./grammar-analysis.server');

const run = (args: string[]) => execFileSync(ffmpeg, ['-v', 'error', '-y', ...args]);
const still = (name: string, source: string) => { const file = join(directory, name); run(['-f', 'lavfi', '-i', source, '-frames:v', '1', file]); return file; };
const [a, b, c] = [still('a.png', 'testsrc2=s=1920x1080'), still('b.png', 'mandelbrot=s=1920x1080'), still('c.png', "nullsrc=s=1920x1080,geq=lum='128+60*sin(X/60)+50*sin(Y/45+X/150)':cb='128+50*sin(Y/80)':cr='150+60*sin(X/90)'")];
// The common caption style: white words on a translucent black box.
const words = (text: string, y: string) => `drawtext=text='${text}':fontsize=44:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=12:x=(w-tw)/2:y=${y}`;
const reference = join(directory, 'reference.mp4');
// A static shot with a title, a pan to the right, and a zoom in with a caption, 2 s each at 30 fps.
run(['-loop', '1', '-t', '2', '-i', a, '-loop', '1', '-t', '2', '-i', b, '-loop', '1', '-t', '2', '-i', c, '-filter_complex', [
  `[0:v]fps=30,crop=960:540:480:270,scale=640:360,${words('SAVE THIS HACK', '30')}[s0]`,
  "[1:v]fps=30,crop=960:540:x='200+300*t':y=270,scale=640:360[s1]",
  `[2:v]fps=30,zoompan=z='1+0.2*on/30':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=640x360:fps=30,${words('PART 2', 'h-th-30')}[s2]`,
  '[s0][s1][s2]concat=n=3:v=1:a=0,format=yuv420p[v]',
].join(';'), '-map', '[v]', '-c:v', 'libx264', reference]);
const signal = () => AbortSignal.timeout(120_000);

test('edit analysis reads each shot\'s camera move and on-screen text, and a remix gives stills the same moves', async () => {
  const project = await createProject({ name: 'Edit grammar' });
  const video = await importLocalProjectAsset({ projectId: project.id, filePath: reference });
  const [first, second] = [await importLocalProjectAsset({ projectId: project.id, filePath: still('square.png', 'gradients=s=1024x1024:d=1') }), await importLocalProjectAsset({ projectId: project.id, filePath: b })];
  const requestId = randomUUID(), queued = await changeRemix(project.id, { action: 'analyze', assetId: video.id, requestId, sensitivity: 8 }, 'cli') as { runId: string };
  const h = openHarness();
  try {
    for (let step = 0; step < 8; step++) await h.step(queued.runId, createRuntimeAdapters());
    const jobs = h.jobs(queued.runId);
    assert.ok(jobs.every(job => job.state === 'succeeded'), JSON.stringify(jobs.map(job => [job.node_id, job.state, job.error])));
  } finally { h.close(); }
  const { remixes } = await changeRemix(project.id, { action: 'list' }, 'cli') as { remixes: import('./contract').RemixView[] };
  const grammar = remixes[0].grammar!;
  assert.deepEqual(grammar.shots.map(shot => Math.round(shot.start)), [0, 2, 4]);
  assert.deepEqual(grammar.shots.map(shot => shot.camera?.kind), ['static', 'pan-right', 'zoom-in']);
  assert.ok(grammar.shots[1].camera!.pan > 0.3, JSON.stringify(grammar.shots[1].camera));
  assert.ok(grammar.shots[2].camera!.zoom > 1.2, JSON.stringify(grammar.shots[2].camera));
  assert.deepEqual(remixes[0].edit, { state: 'succeeded', error: null });
  const ocr = await tesseractEngine(signal());
  if (ocr) {
    assert.equal(grammar.edit?.text, 'read');
    assert.match(grammar.shots[0].text!.join(' '), /SAVE THIS HACK/i); assert.match(grammar.shots[2].text!.join(' '), /PART 2/i);
  } else assert.equal(grammar.edit?.text, 'unavailable');
  const built = await changeRemix(project.id, { action: 'build', requestId, materials: [second.id, first.id], keepSoundtrack: false, keepCamera: true, keepText: true }, 'cli') as { cameraMoves: number; texts: number };
  assert.equal(built.cameraMoves, 2);
  const timeline = (await loadProjectTimeline(project.id))!, clips = timeline.document.tracks.flatMap(track => track.clips);
  const moves = clips.filter(clip => clip.id.endsWith('-camera'));
  assert.deepEqual(moves.map(clip => clip.name.split(' · ')[1]), ['pan-right', 'zoom-in']);
  const [pan, zoom] = moves.map(clip => clip.motion!.keyframes);
  assert.ok(pan[0].x > 0.5 && pan[1].x < 0.5, JSON.stringify(pan));
  assert.ok(zoom[1].width > zoom[0].width && zoom[0].width >= 1, JSON.stringify(zoom));
  if (ocr) {
    const captions = clips.filter(clip => clip.sourceType === 'caption');
    assert.equal(captions.length, built.texts); assert.ok(built.texts >= 2);
    const title = captions.find(clip => /SAVE THIS HACK/i.test(clip.name ?? '') || /SAVE THIS HACK/i.test(JSON.stringify(clip)))!;
    assert.ok(title && title.caption!.bottomOffset > 0.6, JSON.stringify(title?.caption));
  }
  const rendered = await renderProjectTimelineToAsset({ projectId: project.id, document: timeline.document, timelineRevision: timeline.version });
  const frame = (at: number) => execFileSync(ffmpeg, ['-v', 'error', '-ss', String(at), '-i', rendered.localPath, '-vf', 'crop=iw:ih*0.6:0:ih*0.2,scale=48:16', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gray', '-']);
  // The zooming still changes between the start and the end of its shot (above the caption).
  const [early, late] = [frame(4.1), frame(5.8)];
  assert.ok(early.reduce((sum, value, index) => sum + Math.abs(value - late[index]), 0) / early.length > 2);
});
