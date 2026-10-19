import { readFileSync } from 'node:fs';
import { openHarness } from '../src/core/harness/store';
import { type Plan } from '../src/core/harness/durable';
import { createComfyRouterAdapter, isComfyConfigured, routerInput } from '../src/core/harness/comfy-router';

const [command, first, second] = process.argv.slice(2);
const h = openHarness();
const adapters = { 'comfy.router': createComfyRouterAdapter() };
try {
  if (command === 'enqueue') {
    if (!first || !second) throw new Error('Usage: harness enqueue plan.json stable-request-key');
    const plan = JSON.parse(readFileSync(first, 'utf8')) as Plan;
    for (const node of plan.nodes) {
      if (node.operation !== 'comfy.router') throw new Error(`Unsupported operation: ${node.operation}`);
      routerInput.parse(node.input);
      // Native signed URLs are not reusable durable media. Cache is opt-in only after materialization.
      if (node.cache) throw new Error('Router media cache is unavailable until outputs are localized');
    }
    if (!isComfyConfigured()) throw new Error('Set COMFY_API_KEY in the server environment before queuing paid generation.');
    console.log(JSON.stringify({ runId: h.enqueue(plan, second) }));
  } else if (command === 'inspect' && first) {
    console.log(JSON.stringify({ jobs: h.jobs(first), events: h.events(first) }, null, 2));
  } else if (command === 'list' && first) {
    console.log(JSON.stringify(h.runs(first), null, 2));
  } else if (command === 'cancel' && first) {
    h.cancel(first); console.log('Cancellation requested. Run worker to reconcile remote status.');
  } else if (command === 'tick' && first) {
    if (!isComfyConfigured()) throw new Error('COMFY_API_KEY is not configured');
    await h.step(first, adapters); console.log(JSON.stringify(h.jobs(first), null, 2));
  } else if (command === 'worker' && first) {
    if (!isComfyConfigured()) throw new Error('COMFY_API_KEY is not configured');
    let stopping = false;
    process.on('SIGINT', () => { stopping = true; }); process.on('SIGTERM', () => { stopping = true; });
    while (!stopping) {
      const progressed = await h.step(first, adapters);
      const active = h.jobs(first).some(j => ['queued', 'submitting', 'running'].includes(j.state));
      if (!active) break;
      if (!progressed) await new Promise(r => setTimeout(r, 1000));
    }
    console.log(JSON.stringify(h.jobs(first), null, 2));
  } else throw new Error('Usage: harness enqueue <plan> <request-key> | inspect/list/cancel/tick/worker <run-or-project-id>');
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Harness failed'); process.exitCode = 1;
} finally { h.close(); }
