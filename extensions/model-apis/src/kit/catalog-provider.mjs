import { ApiError, isTransient } from './http.mjs';
import { admit, requestBody, collectMedia } from './catalog-request.mjs';
import { readReference, downloadResult } from './media.mjs';
import { createPacer, processing, taskId, parseTaskId, unknownCost } from './polling.mjs';

/**
 * Shared lifecycle for schema-driven catalogs. A vendor supplies only:
 *   client(configuration, signal) -> api
 *   upload(api, { bytes, mimeType }) -> URL the vendor can read
 *   submit(api, binding, body, idempotencyKey) -> upstream task ID
 *   poll(api, upstreamId) -> { state: 'processing' | 'failed' | 'succeeded', output?, error?, cost? }
 *   test(api) -> resolves when the key works
 */
export function catalogProvider({ prefix, label, catalog, client, upload, submit, poll, test, download = {} }) {
  const entries = new Map(catalog.models.map(entry => [entry.model.id, entry]));
  const pacer = createPacer();
  const entryFor = id => { const entry = entries.get(id); if (!entry) throw Error('Unknown ' + label + ' model: ' + id); return entry; };

  async function createGeneration({ model, input, configuration, signal, readMedia, requestKey }) {
    const { model: profile, binding } = entryFor(model.id);
    const admitted = admit(profile, binding, input);
    if (typeof requestKey !== 'string' || !requestKey || requestKey.length > 200) throw Error(label + ' requires a durable generation ID');
    const api = client(configuration, signal);
    const uploaded = { image: [], video: [], audio: [] };
    for (const kind of Object.keys(uploaded)) for (const reference of admitted.refs[kind]) uploaded[kind].push(await upload(api, await readReference(readMedia, reference)));
    if (input.maskUrl) uploaded.mask = await upload(api, await readReference(readMedia, input.maskUrl));
    const body = requestBody(profile, binding, admitted, uploaded, input.seed);
    let upstream;
    try { upstream = await submit(api, binding, body, requestKey + ':' + model.id); }
    catch (error) {
      // A rejected request is safe to fix and resend; anything else may already be running and billed.
      if (error instanceof ApiError && error.status >= 400 && !isTransient(error)) throw error;
      throw Error(label + ' submission outcome is unknown. Check your ' + label + ' request history before creating another generation.');
    }
    const id = taskId(prefix, upstream);
    pacer.defer(id);
    return { status: 'processing', taskId: id, cost: unknownCost };
  }

  async function checkStatus({ model, taskId: id, configuration, signal }) {
    const { model: profile } = entryFor(model.id), upstream = parseTaskId(prefix, id);
    if (pacer.wait(id)) return processing(id);
    const api = client(configuration, signal);
    let result;
    try { result = await poll(api, upstream); }
    catch (error) { if (isTransient(error)) { pacer.defer(id, error.retryAfter); return processing(id); } throw error; }
    if (result.state === 'processing') { pacer.defer(id); return { ...processing(id), ...(result.cost ? { cost: result.cost } : {}) }; }
    pacer.done(id);
    if (result.state === 'failed') return { status: 'failed', taskId: id, error: label + ': ' + (result.error || 'generation failed') + '. See your ' + label + ' request history.', ...(result.cost ? { cost: result.cost } : {}) };
    const found = collectMedia(result.output, profile.kind);
    if (!found.length) throw Error(label + ' finished without ' + profile.kind + ' output');
    const media = [];
    for (const item of found.slice(0, 8)) media.push(await downloadResult(label, item.url, profile.kind, { signal, headers: download.headers?.(api) }));
    return { status: 'succeeded', taskId: id, media, ...(result.cost ? { cost: result.cost } : {}) };
  }

  async function testConnection({ configuration, signal }) { await test(client(configuration, signal)); return { ok: true }; }
  return { createGeneration, checkStatus, testConnection };
}
