import './default-providers.mjs';
import { openHarness } from '../src/core/harness/store';
import { runtimeCapabilities, unavailableOperations } from '../src/core/harness/capabilities';
import { createRuntimeAdapters } from '../src/core/harness/adapters';
import { createWorkerPool, workerLimits } from '../src/core/harness/worker-pool.server';

const h = openHarness();
const limits = workerLimits();
const pool = createWorkerPool(h, createRuntimeAdapters(), limits);
let stopping = false;
process.on('SIGINT', () => { stopping = true; });
process.on('SIGTERM', () => { stopping = true; });
console.log('Viral Hit worker ready:', runtimeCapabilities().filter(c => c.configured).map(c => c.label).join(', '),
  `(up to ${limits.total} steps at once, ${limits.perProvider} per model service, ${limits.local} local)`);
const failed = () => console.error('Worker step failed; retained jobs will be reconciled on the next pass.');
try {
  // Leases fence each job to one step and slots bound concurrency, so steps overlap safely.
  while (!stopping) {
    try { pool.tick(unavailableOperations(), failed); } catch { failed(); }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  await pool.drain();
} finally { h.close(); }
