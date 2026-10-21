import { managedRuntimeSnapshot } from '../src/core/runtime-packages/snapshot.server';
import { setTimeout } from 'node:timers/promises';
import { openPublications } from '../src/core/publishing/publication-files.server';
import { openPublicationRuntime } from '../src/core/publishing/runtime.server';
import { runPublicationStep } from '../src/core/publishing/worker.server';

managedRuntimeSnapshot();
const shutdown = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => shutdown.abort());
const store = openPublications();
try {
  const runtime = openPublicationRuntime();
  try {
    console.log('Viral Hit publication worker ready');
    while (!shutdown.signal.aborted) {
      let worked = false;
      try { worked = Boolean(await runPublicationStep(store, runtime, shutdown.signal)); }
      catch { if (!shutdown.signal.aborted) console.error('Publication step failed; durable state retained for reconciliation.'); }
      if (!worked && !shutdown.signal.aborted) {
        try { await setTimeout(1000, undefined, { signal: shutdown.signal }); }
        catch (error) { if (!shutdown.signal.aborted) throw error; }
      }
    }
  } finally { runtime.close(); }
} finally { store.close(); }
