import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INSTAGRAM_FEED_RATIO, INSTAGRAM_STORY_RATIO, feedRatio, planInstagramImage } from './instagram-frame';
import { InstagramImageError, probeInstagramImage, renderInstagramJpeg } from './instagram-image.server';

const directory = await mkdtemp(join(tmpdir(), 'vh-instagram-image-'));
after(() => rm(directory, { recursive: true, force: true }));
const ffmpeg = process.env.VIRAL_HIT_FFMPEG || 'ffmpeg', signal = () => AbortSignal.timeout(30000);
const source = (name: string, graph: string) => { const file = join(directory, name); execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', graph, '-frames:v', '1', file]); return file; };
const inRange = (plan: { width: number; height: number }) => plan.width / plan.height >= INSTAGRAM_FEED_RATIO.min && plan.width / plan.height <= INSTAGRAM_FEED_RATIO.max;

test('framing keeps feed images inside 4:5–1.91:1 with even sizes and no upscaling', () => {
  const tall = planInstagramImage({ width: 1080, height: 1920 }, feedRatio(1080, 1920), 'fill', 1440);
  assert.deepEqual(tall, { width: 1080, height: 1350, frame: 'fill', crop: { width: 1080, height: 1350, x: 0, y: 285 } });
  const wide = planInstagramImage({ width: 3000, height: 1000 }, feedRatio(3000, 1000), 'fill', 1440);
  assert.equal(wide.width, 1440); assert.ok(inRange(wide)); assert.deepEqual(wide.crop, { width: 1910, height: 1000, x: 545, y: 0 });
  assert.deepEqual(planInstagramImage({ width: 1024, height: 1024 }, 1, 'fill', 1440), { width: 1024, height: 1024, frame: 'fill', crop: null });
  assert.deepEqual(planInstagramImage({ width: 201, height: 201 }, 1, 'fill', 1440), { width: 200, height: 200, frame: 'fill', crop: null });
  const fit = planInstagramImage({ width: 1080, height: 1920 }, 0.8, 'fit', 1440);
  assert.deepEqual(fit, { width: 1440, height: 1800, frame: 'fit', crop: null });
  const story = planInstagramImage({ width: 1024, height: 1024 }, INSTAGRAM_STORY_RATIO, 'fit', 1080, false);
  assert.equal(story.width, 1024); assert.equal(story.height, 1820);
  for (const [width, height] of [[999, 1300], [1001, 523], [4000, 4999], [1919, 1005], [321, 401]]) for (const frame of ['fill', 'fit'] as const) {
    const plan = planInstagramImage({ width, height }, feedRatio(width, height), frame, 1440);
    assert.ok(inRange(plan), `${width}x${height} ${frame}`); assert.equal(plan.width % 2 + plan.height % 2, 0); assert.ok(plan.width <= 1440);
  }
});

test('conversion writes the planned JPEG and flattens transparency onto white', async () => {
  const tall = source('tall.png', 'testsrc2=s=1080x1920,format=rgba,colorchannelmixer=aa=0.6');
  assert.deepEqual(await probeInstagramImage(tall, signal()), { width: 1080, height: 1920 });
  for (const frame of ['fill', 'fit'] as const) {
    const plan = planInstagramImage({ width: 1080, height: 1920 }, 0.8, frame, 1440), output = join(directory, `tall-${frame}.jpg`);
    await renderInstagramJpeg(tall, output, plan, signal());
    const bytes = await readFile(output);
    assert.deepEqual([...bytes.subarray(0, 3)], [0xff, 0xd8, 0xff]); assert.ok(bytes.length < 8_000_000);
    assert.deepEqual(await probeInstagramImage(output, signal()), { width: plan.width, height: plan.height });
  }
  const clear = source('clear.png', 'color=c=black@0.0:s=64x64,format=rgba'), white = join(directory, 'clear.jpg');
  await renderInstagramJpeg(clear, white, planInstagramImage({ width: 64, height: 64 }, 1, 'fill', 1440), signal());
  const luma = execFileSync(ffmpeg, ['-v', 'error', '-i', white, '-f', 'rawvideo', '-pix_fmt', 'gray', '-']);
  assert.ok(Math.min(...luma) >= 250, 'transparent pixels become white, not black');
});

test('unreadable input is reported as an image problem without tool output', async () => {
  const text = join(directory, 'not-image.png');
  execFileSync('sh', ['-c', `printf 'not an image' > "${text}"`]);
  await assert.rejects(probeInstagramImage(text, signal()), InstagramImageError);
});
