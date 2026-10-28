import { mkdir, writeFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { configuration, hash, readBounded, validId } from './config.mjs';
import { run } from './process.mjs';
import { report, validateEvidence } from './report.mjs';

export function validateInput(input) {
  if (!input || !validId(input.targetId) || !['javascript', 'website'].includes(input.kind) || typeof input.question !== 'string' || !input.question.trim() || input.question.length > 2000) throw Error('Choose a target and describe the feature to investigate');
}
const receipt = (input, key) => hash(JSON.stringify([input, key]));
const completedPath = (config, id) => join(config.directory, id, 'report.json');
async function completed(config, id, expected) {
  try {
    const stored = JSON.parse(await readBounded(completedPath(config, id), 131072));
    if (stored.identity !== config.identity || stored.result.receiptId !== id || stored.result.targetId !== config.target.id || expected && stored.result.projectId !== expected) throw Error('Retained REA report identity mismatch');
    return stored.result;
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function atomic(file, value) { await writeFile(file + '.tmp', JSON.stringify(value), { flag: 'wx', mode: 0o600 }); await rename(file + '.tmp', file); }
export default {
  recovery: 'reconcile',
  async submit(input, context) {
    validateInput(input); if (!validId(context.projectId) || !validId(context.key)) throw Error('REA requires a project and durable request identity');
    const config = await configuration(input.targetId), id = receipt(input, context.key);
    if (config.target.kind !== input.kind) throw Error('Recipe does not match the configured target kind');
    if (await completed(config, id, context.projectId)) return { id };
    await mkdir(config.directory, { recursive: true, mode: 0o700 });
    const lock = join(config.directory, '.analysis-lock'), work = join(config.directory, id);
    try { await mkdir(lock, { mode: 0o700 }); } catch (error) { if (error.code === 'EEXIST') throw Error('Another REA analysis holds this evidence-directory lock. Inspect it before clearing a stale lock.'); throw error; }
    try {
      await writeFile(join(lock, 'owner.json'), JSON.stringify({ pid: process.pid, id, createdAt: new Date().toISOString() }), { flag: 'wx', mode: 0o600 });
      await mkdir(work, { mode: 0o700 }); // Existing incomplete intents must never silently rerun.
      await atomic(join(work, 'intent.json'), { id, projectId: context.projectId, targetId: input.targetId, identity: config.identity });
      const evidence = []; let failure;
      const capture = async (operation, args, file) => {
        const value = validateEvidence(await run(config.node, config.cli, args, { cwd: work, signal: context.signal }), operation);
        const bytes = Buffer.from(JSON.stringify(value));
        await writeFile(join(work, file), bytes, { flag: 'wx', mode: 0o600 }); evidence.push({ value, bytes, file });
      };
      if (input.kind === 'javascript') {
        await capture('analyze_javascript_application', ['analyze-javascript-application', config.target.path, '--max-heap-mb', '256', '--analysis-timeout-ms', '20000', '--max-semantic-nodes', '2000', '--max-semantic-nodes-per-file', '500', '--max-semantic-unknowns', '2000', '--max-semantic-unknowns-per-file', '500'], 'application.json');
      } else {
        const targetArgs = [config.target.endpoint, config.target.targetId, '--allowed-origins', config.target.origin];
        await capture('inspect_web_page', ['inspect-web-page', ...targetArgs, '--observation-ms', '500', '--command-timeout-ms', '10000'], 'page.json');
        try { await capture('analyze_web_bundle', ['analyze-web-bundle', ...targetArgs, '--observation-ms', '500', '--command-timeout-ms', '10000', '--max-heap-mb', '256', '--analysis-timeout-ms', '15000', '--total-analysis-timeout-ms', '45000'], 'bundle.json'); }
        catch (error) { context.signal.throwIfAborted(); failure = error.message; }
      }
      context.signal.throwIfAborted();
      if ((await configuration(input.targetId)).identity !== config.identity) throw Error('REA configuration changed during analysis');
      const result = report({ input, target: config.target, projectId: context.projectId, receiptId: id, evidence, failure });
      await atomic(completedPath(config, id), { identity: config.identity, result });
      return { id };
    } finally { await rm(lock, { recursive: true, force: true }); }
  },
  async reconcile(input, context) {
    context.signal.throwIfAborted(); validateInput(input);
    const config = await configuration(input.targetId), id = receipt(input, context.key);
    return await completed(config, id) ? { id } : null;
  },
  async poll(id, input, signal, context) {
    signal.throwIfAborted(); validateInput(input);
    if (!/^[a-f0-9]{64}$/.test(id)) return { state: 'failed', error: 'Invalid REA receipt' };
    try {
      const result = await completed(await configuration(input.targetId), id, context.projectId);
      return result ? { state: 'succeeded', output: result } : { state: 'uncertain', error: 'REA evidence was not retained; inspect the original run before starting another observation' };
    } catch (error) {
      signal.throwIfAborted();
      return { state: 'uncertain', error: String(error.message).slice(0, 1000) };
    }
  },
  async cancel() { return { state: 'canceled' }; },
};
