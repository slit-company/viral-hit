import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { getViralHitDataRoot } from '../../config/data-root';
import { agentRunAdmission } from '../agent/run-admission.server';
import { DurableHarness } from './durable';

export function openHarness() {
  const file = resolve(process.env.VIRAL_HIT_HARNESS_DB || resolve(getViralHitDataRoot(), 'harness.db'));
  mkdirSync(dirname(file), { recursive: true });
  const h = new DurableHarness(file);
  // Runs an agent queues may wait for a person; see docs/AGENT.md.
  h.admission = (plan) => agentRunAdmission(h.db, plan);
  return h;
}
