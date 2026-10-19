import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { getViralHitDataRoot } from '../../config/data-root';
import { DurableHarness } from './durable';

export function openHarness() {
  const file = resolve(process.env.VIRAL_HIT_HARNESS_DB || resolve(getViralHitDataRoot(), 'harness.db'));
  mkdirSync(dirname(file), { recursive: true });
  return new DurableHarness(file);
}
