import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { buildOverlayFilters } from './overlay-render.server';
import { overlayTransformAt } from './overlay-motion';
import { createTimelineDocument, addOverlayClip, overlayOpacityAt } from './timeline-document';

const ffmpeg = process.env.VIRAL_HIT_FFMPEG || 'ffmpeg';
test('real FFmpeg frames match all five animated transforms, delayed placement and half-open visibility', () => {
  const document = addOverlayClip(createTimelineDocument({ projectId: 'render', name: 'Render' }), { clipId: 'overlay', assetId: 'image', sourceUrl: '/image.png', name: 'Image', startTime: 1, duration: 2 });
  const clip = document.tracks.flatMap(track => track.clips)[0];
  clip.motion = { version: 1, keyframes: [
    { id: 'a', time: 0, x: .25, y: .3, width: .15, opacity: .3, rotation: -40, easing: 'ease-in-out' },
    { id: 'b', time: 2, x: .7, y: .65, width: .35, opacity: .9, rotation: 50, easing: 'linear' },
  ] };
  const width = 320, height = 240, fps = 10;
  const built = buildOverlayFilters({ clip, inputIndex: 1, inputWidth: 80, inputHeight: 40, width, height, visualLabel: '0:v', index: 1 });
  const raw = execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', `color=black:s=${width}x${height}:r=${fps}:d=4`, '-f', 'lavfi', '-i', `color=white:s=80x40:r=${fps}:d=2`, '-filter_complex', built.filters.join(';'), '-map', `[${built.output}]`, '-frames:v', '40', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'], { maxBuffer: 20 * 1024 * 1024 });
  for (const time of [0, .9, 1, 1.5, 2, 2.5, 2.9, 3, 3.5]) {
    const frame = raw.subarray(Math.round(time * fps) * width * height * 3, (Math.round(time * fps) + 1) * width * height * 3);
    let minX = width, minY = height, maxX = -1, maxY = -1;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (frame[(y * width + x) * 3] > 25) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    if (time < 1 || time >= 3) { assert.equal(maxX, -1, `hidden at ${time}`); continue; }
    const pose = overlayTransformAt(clip, time)!;
    assert.ok(Math.abs((minX + maxX) / 2 - pose.x * width) < 3, `x at ${time}`);
    assert.ok(Math.abs((minY + maxY) / 2 - pose.y * height) < 3, `y at ${time}`);
    const radians = pose.rotation * Math.PI / 180;
    const expectedWidth = pose.width * width * (Math.abs(Math.cos(radians)) + .5 * Math.abs(Math.sin(radians)));
    const expectedHeight = pose.width * width * (Math.abs(Math.sin(radians)) + .5 * Math.abs(Math.cos(radians)));
    assert.ok(Math.abs(maxX - minX + 1 - expectedWidth) < 5, `width/rotation at ${time}: ${maxX - minX + 1} vs ${expectedWidth}`);
    assert.ok(Math.abs(maxY - minY + 1 - expectedHeight) < 5, `height/rotation at ${time}`);
    const center = frame[(Math.round(pose.y * height) * width + Math.round(pose.x * width)) * 3];
    assert.ok(Math.abs(center - pose.opacity * 255) < 8, `opacity at ${time}: ${center} vs ${pose.opacity * 255}`);
  }
});

test('delayed overlays use local fade clocks and minimum envelope when fades overlap', () => {
  const document = addOverlayClip(createTimelineDocument({ projectId: 'fade', name: 'Fade' }), { clipId: 'overlay', assetId: 'image', sourceUrl: '/image.png', name: 'Image', startTime: 1, duration: 2, width: .5, x: .5, y: .5, opacity: .8, fadeIn: 2, fadeOut: 2 });
  const clip = document.tracks.flatMap(track => track.clips)[0];
  const built = buildOverlayFilters({ clip, inputIndex: 1, inputWidth: 80, inputHeight: 40, width: 160, height: 90, visualLabel: '0:v', index: 1 });
  const raw = execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=black:s=160x90:r=10:d=4', '-f', 'lavfi', '-i', 'color=white:s=80x40:r=10:d=2', '-filter_complex', built.filters.join(';'), '-map', `[${built.output}]`, '-frames:v', '40', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'], { maxBuffer: 4 * 1024 * 1024 });
  for (const time of [.5, 1, 1.5, 2, 2.5, 2.9, 3]) {
    const center = raw[(Math.round(time * 10) * 160 * 90 + 45 * 160 + 80) * 3];
    assert.ok(Math.abs(center - overlayOpacityAt(clip, time) * 255) < 5, `fade at ${time}`);
  }
});
