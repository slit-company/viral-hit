import { openHarness } from '../src/core/harness/store';
import { runtimeCapabilities, unavailableOperations } from '../src/core/harness/capabilities';
import { createRuntimeAdapters } from '../src/core/harness/adapters';



const h = openHarness();
const adapters = createRuntimeAdapters();
let stopping = false;
process.on('SIGINT', () => { stopping = true; });
process.on('SIGTERM', () => { stopping = true; });
console.log('Viral Hit worker ready:', runtimeCapabilities().filter(c => c.configured).map(c => c.label).join(', '));
try {
  while (!stopping) {
    // Sequential calls cap local external concurrency at one. Leases also fence another worker.
    {
      const runs = h.db.prepare("SELECT DISTINCT run_id FROM vh_jobs WHERE state IN ('queued','submitting','running') ORDER BY rowid").all();
      for (const run of runs) {
        if (stopping) break;
        try { await h.step(String(run.run_id), adapters, unavailableOperations()); }
        catch { console.error('Worker step failed; retained jobs will be reconciled on the next pass.'); }
      }
    }
    if (!stopping) await new Promise(resolve => setTimeout(resolve, 1000));
  }
} finally { h.close(); }
