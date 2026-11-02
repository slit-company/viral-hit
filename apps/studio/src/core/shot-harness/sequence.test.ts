import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DurableHarness } from '../harness/durable';
import type { ShotRunView } from './contract';
import { placeShot, readShotRecords } from './records.server';
import { groupShotSequences, readyTakes } from './sequence';

test('placing runs keeps attempts at their shot position, appends new shots and replays a request', () => {
  const directory = mkdtempSync(join(tmpdir(), 'vh-shots-'));
  const h = new DurableHarness(join(directory, 'harness.db'));
  try {
    const first = placeShot(h, 'p', { requestId: 'r1', sequenceId: 's', shotId: 'a', spec: { subject: 'one' }, continuesFrom: null });
    const second = placeShot(h, 'p', { requestId: 'r2', sequenceId: 's', shotId: 'b', spec: { subject: 'two' }, continuesFrom: 'take-1' });
    const retry = placeShot(h, 'p', { requestId: 'r3', sequenceId: 's', shotId: 'b', spec: { subject: 'two again' }, continuesFrom: 'take-1' });
    const other = placeShot(h, 'q', { requestId: 'r4', sequenceId: 's', shotId: 'c', spec: {}, continuesFrom: null });
    assert.deepEqual([first.position, second.position, retry.position, other.position], [1, 2, 2, 1]);
    assert.equal(placeShot(h, 'p', { requestId: 'r2', sequenceId: 's', shotId: 'z', spec: {}, continuesFrom: null }).shotId, 'b', 'a replayed request keeps its placement');
    const records = readShotRecords(h, 'p');
    assert.equal(records.size, 3);
    assert.equal(records.get('r2')?.continuesFrom, 'take-1');
  } finally {
    h.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('runs group into ordered positions with the newest attempt first', () => {
  const run = (requestId: string, sequenceId: string, position: number, createdAt: number, assetId?: string): ShotRunView => ({
    runId: requestId, requestId, createdAt, prompt: requestId, modelId: 'm', stillModelId: null, durationSec: 3, audio: false, still: null,
    takes: [{ jobId: requestId, nodeId: 'take-1', state: assetId ? 'succeeded' : 'running', error: null, ...(assetId ? { assetId } : {}) }],
    sequenceId, shotId: sequenceId + position, position, attempt: 1, spec: null, continuesFrom: null,
  });
  const [latest, older] = groupShotSequences([run('a1', 's', 1, 1, 'x'), run('b1', 's', 2, 2), run('b2', 's', 2, 5, 'y'), run('solo', 't', 1, 3)]);
  assert.equal(latest.sequenceId, 's');
  assert.equal(older.sequenceId, 't');
  assert.deepEqual(latest.positions.map((slot) => [slot.position, slot.attempts.map((attempt) => attempt.requestId)]), [[1, ['a1']], [2, ['b2', 'b1']]]);
  assert.deepEqual(readyTakes(latest.positions[1]).map(({ take }) => take.assetId), ['y']);
});
