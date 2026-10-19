import { readFileSync } from 'node:fs';
import { openHarness } from '../src/core/harness/store';
import { type Plan } from '../src/core/harness/durable';
import { createMaterializeAdapter } from '../src/core/harness/materialize';
import { runtimeNodeSchema } from '../src/core/harness/requests';
import { createComfyRouterAdapter, isComfyConfigured } from '../src/core/harness/comfy-router';

const [command, first, second] = process.argv.slice(2);
const h = openHarness();
const adapters = { 'comfy.router': createComfyRouterAdapter(), 'asset.materialize': createMaterializeAdapter() };
try {
  if (command === 'enqueue') {
    if (!first || !second) throw new Error('Usage: harness enqueue plan.json stable-request-key');
    const plan = JSON.parse(readFileSync(first, 'utf8')) as Plan;
    plan.nodes = plan.nodes.map(node => runtimeNodeSchema.parse(node));
    if (plan.nodes.some(node => node.operation === 'comfy.router') && !isComfyConfigured()) throw new Error('Set COMFY_API_KEY before queuing paid generation.');
    console.log(JSON.stringify({ runId: h.enqueue(plan, second) }));
  } else if (command === 'inspect' && first) {
    console.log(JSON.stringify({ jobs: h.jobs(first), events: h.events(first) }, null, 2));
  } else if (command === 'list' && first) {
    console.log(JSON.stringify(h.runs(first), null, 2));
  } else if (command === 'cancel' && first) {
    h.cancel(first); console.log('Cancellation requested. Run worker to reconcile remote status.');
  } else if (command === 'tick' && first) {
    await h.step(first, adapters, isComfyConfigured() ? [] : ['comfy.router']); console.log(JSON.stringify(h.jobs(first), null, 2));
  } else if (command === 'worker' && first) {
    let stopping = false;
    process.on('SIGINT', () => { stopping = true; }); process.on('SIGTERM', () => { stopping = true; });
    while (!stopping) {
      const progressed = await h.step(first, adapters, isComfyConfigured() ? [] : ['comfy.router']);
      const active = h.jobs(first).some(j => ['queued', 'submitting', 'running'].includes(j.state));
      if (!active) break;
      if (!progressed) await new Promise(r => setTimeout(r, 1000));
    }
    console.log(JSON.stringify(h.jobs(first), null, 2));
  } else throw new Error('Usage: harness enqueue <plan> <request-key> | inspect/list/cancel/tick/worker <run-or-project-id>');
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Harness failed'); process.exitCode = 1;
} finally { h.close(); }
