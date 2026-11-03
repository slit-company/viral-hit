import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Adapter, Plan } from '../harness/durable';

const directory = await mkdtemp(join(tmpdir(), 'vh-agent-test-'));
process.env.VIRAL_HIT_DATA_DIR = directory;
process.env.VIRAL_HIT_HARNESS_DB = join(directory, 'harness.db');
after(async () => rm(directory, { recursive: true, force: true }));
const { openHarness } = await import('../harness/store');
const { runAsAgent } = await import('./request-origin.server');
const { AgentApprovalRequired, changeAgent, readAgentMemory, readApprovals, requireAgentApproval } = await import('./agent.server');
const { MEMORY_SCOPE_LIMIT } = await import('./contract');

const agent = <T>(work: () => T) => runAsAgent({ channel: 'mcp', tool: 'viral_hit_shot' }, work);
const plan = (projectId: string, operation: string, prompt = 'A red kite over the sea'): Plan =>
  ({ projectId, nodes: [{ id: 'make', operation, version: '1', input: { modelId: 'fixture/video', prompt } }] });
let submits = 0;
const adapters: Record<string, Adapter> = Object.fromEntries(['generation.model', 'editor.sequence'].map((operation) => [operation, {
  recovery: 'replay', async submit() { submits += 1; return { id: 'remote-' + submits }; },
  async poll() { return { state: 'succeeded', output: { ok: true } }; },
} satisfies Adapter]));
const held = (h: ReturnType<typeof openHarness>, runId: string) => (h.db.prepare('SELECT held FROM vh_runs WHERE id=?').get(runId) as { held: number }).held;

test('generation runs an agent queues wait for a person; runs people start, and non-generation runs, start at once', async () => {
  const h = openHarness();
  try {
    assert.throws(() => changeAgent({ action: 'set_mode', mode: 'ask' }, 'agent'), /Only a person/);
    changeAgent({ action: 'set_mode', mode: 'ask' }, 'person');
    const waiting = agent(() => h.enqueue(plan('p1', 'generation.model'), 'agent-1'));
    assert.equal(held(h, waiting), 1);
    const [approval] = readApprovals('pending');
    assert.equal(approval.runId, waiting);
    // The fixture model publishes no price, so the step says so instead of guessing.
    assert.deepEqual(approval.steps, [{ label: 'Installed generation model', model: 'fixture/video', prompt: 'A red kite over the sea', cost: null }]);
    assert.equal(approval.tool, 'viral_hit_shot');
    assert.equal(await h.step(waiting, adapters), false, 'a held run claims nothing');
    assert.equal(submits, 0);
    assert.equal(agent(() => h.enqueue(plan('p1', 'generation.model'), 'agent-1')), waiting, 'replaying the request returns the same run');
    assert.equal(readApprovals('pending').length, 1, 'and no second approval');

    assert.equal(held(h, agent(() => h.enqueue(plan('p1', 'editor.sequence'), 'agent-edit'))), 0, 'no generation step, no approval');
    assert.equal(held(h, h.enqueue(plan('p1', 'generation.model', 'person'), 'person-1')), 0, 'a person started it');

    assert.throws(() => changeAgent({ action: 'decide', id: approval.id, decision: 'approve' }, 'agent'), /Only a person/);
    assert.equal(changeAgent({ action: 'decide', id: approval.id, decision: 'approve' }, 'person').approval?.state, 'approved');
    assert.equal(held(h, waiting), 0);
    assert.equal(await h.step(waiting, adapters), true);
    assert.equal(submits, 1, 'the approved run submits');

    const refused = agent(() => h.enqueue(plan('p1', 'generation.model', 'refuse me'), 'agent-2'));
    const second = readApprovals('pending').find((item) => item.runId === refused)!;
    changeAgent({ action: 'decide', id: second.id, decision: 'reject' }, 'person');
    assert.deepEqual(h.jobs(refused).map((job) => job.state), ['canceled']);
    assert.equal(await h.step(refused, adapters), false);
    assert.equal(changeAgent({ action: 'decide', id: second.id, decision: 'approve' }, 'person').approval?.state, 'rejected', 'a decision stands');

    changeAgent({ action: 'set_mode', mode: 'off' }, 'person');
    assert.equal(held(h, agent(() => h.enqueue(plan('p1', 'generation.model', 'off'), 'agent-3'))), 0, 'asking is off');
  } finally { h.close(); }
});

test('direct agent generation needs one approval per request and replays with its idempotency key', () => {
  changeAgent({ action: 'set_mode', mode: 'ask' }, 'person');
  const request = (key: string | null, prompt = 'Neon alley, slow push-in') => () => requireAgentApproval({
    projectId: 'p1', gate: 'canvas-generation', request: { modelId: 'fixture/image', prompt }, key, steps: [{ label: 'image', model: 'fixture/image', prompt }],
  });
  assert.doesNotThrow(request('k1'), 'people are never asked');
  const first = (() => { try { agent(request('k1')); } catch (error) { return error; } })();
  assert.ok(first instanceof AgentApprovalRequired && first.approval.state === 'pending');
  assert.match(first.message, /call this tool again with the same arguments/);
  assert.throws(() => agent(request('k1')), (error) => error instanceof AgentApprovalRequired && error.approval.id === first.approval.id);
  changeAgent({ action: 'decide', id: first.approval.id, decision: 'approve' }, 'person');
  assert.doesNotThrow(() => agent(request('k1')), 'approved once');
  assert.doesNotThrow(() => agent(request('k1')), 'the same key replays the submitted request');
  assert.throws(() => agent(request('k2')), AgentApprovalRequired, 'a new key is a new generation');

  const unkeyed = (() => { try { agent(request(null, 'one-off')); } catch (error) { return error as InstanceType<typeof AgentApprovalRequired>; } })()!;
  changeAgent({ action: 'decide', id: unkeyed.approval.id, decision: 'approve' }, 'person');
  assert.doesNotThrow(() => agent(request(null, 'one-off')));
  assert.throws(() => agent(request(null, 'one-off')), (error) => error instanceof AgentApprovalRequired && error.approval.id !== unkeyed.approval.id, 'without a key, repeating it asks again');

  const refused = (() => { try { agent(request('k3', 'refused')); } catch (error) { return error as InstanceType<typeof AgentApprovalRequired>; } })()!;
  changeAgent({ action: 'decide', id: refused.approval.id, decision: 'reject' }, 'person');
  assert.throws(() => agent(request('k3', 'refused')), /A person rejected this generation/);
  changeAgent({ action: 'set_mode', mode: 'off' }, 'person');
  assert.doesNotThrow(() => agent(request('k4', 'asking off')));
});

test('memory keeps workspace and project entries, rewrites in place and stays bounded', () => {
  const workspace = changeAgent({ action: 'remember', text: 'Captions in Korean, casual tone', projectId: null }, 'person').memory!;
  const project = changeAgent({ action: 'remember', text: 'This launch uses the coral palette', projectId: 'p1' }, 'agent').memory!;
  assert.equal(workspace.source, 'person');
  assert.equal(project.source, 'agent');
  assert.deepEqual(readAgentMemory('p1').map((entry) => entry.text).sort(), ['Captions in Korean, casual tone', 'This launch uses the coral palette']);
  assert.deepEqual(readAgentMemory('p2').map((entry) => entry.text), ['Captions in Korean, casual tone'], 'other projects see only workspace memory');
  changeAgent({ action: 'remember', id: project.id, text: 'This launch uses the ocean palette', projectId: 'p1' }, 'person');
  assert.equal(readAgentMemory('p1').find((entry) => entry.id === project.id)?.text, 'This launch uses the ocean palette');
  assert.throws(() => changeAgent({ action: 'remember', text: 'x'.repeat(601), projectId: null }, 'agent'));
  changeAgent({ action: 'forget', id: project.id }, 'agent');
  assert.throws(() => changeAgent({ action: 'forget', id: project.id }, 'agent'), /not found/);
  for (let index = 0; index < MEMORY_SCOPE_LIMIT; index += 1) changeAgent({ action: 'remember', text: 'Note ' + index, projectId: 'p3' }, 'agent');
  assert.throws(() => changeAgent({ action: 'remember', text: 'One too many', projectId: 'p3' }, 'agent'), /up to 200 entries/);
});
