import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compareFaces, faceMatchProblem } from './face-match-engine.server';

// Runs only where the face models and Python OpenCV are installed (pnpm character face-setup).
const problem = await faceMatchProblem();

test('the Python bridge reads images, reports faces per frame and never invents a match', { skip: problem ?? false }, async () => {
  const folder = mkdtempSync(join(tmpdir(), 'face-bridge-')), still = join(folder, 'pattern.png');
  execFileSync(process.env.VIRAL_HIT_FFMPEG || 'ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360', '-frames:v', '1', '-y', still]);
  const result = await compareFaces([still], [{ id: 'pattern', frames: [{ time: 1.5, path: still }, { time: 2, path: join(folder, 'missing.jpg') }] }], AbortSignal.timeout(60_000));
  assert.deepEqual(result, { referenceFaces: 0, candidates: [{ id: 'pattern', frames: [{ time: 1.5, faces: 0, similarity: null }, { time: 2, faces: 0, similarity: null }] }] });
});
