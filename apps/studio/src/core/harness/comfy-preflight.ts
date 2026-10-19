import { pointerParts } from './bindings';
import { compilePlan, type Plan } from './durable';
import { comfyWorkflowUrl, connectionHash, workflowInput } from './comfy-workflow';

export type PreflightIssue = { step: string; node: string; classType: string; input?: string; severity: 'issue' | 'deferred'; message: string; choices?: (string | number | boolean)[]; choiceCount?: number };
export type ComfyPreflight = { status: 'checked' | 'issues' | 'unavailable' | 'not-applicable'; checkedAt: string; connection: string | null; classes: { name: string; status: 'available' | 'missing' | 'unavailable' }[]; issues: PreflightIssue[]; limits: string };
const limits = 'Checks reported node schemas and current input choices only. No job or upload is submitted. Custom validation, output files, project image integrity and model quality are not verified by this check.';
const isRecord = (v: unknown): v is Record<string, any> => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const overlaps = (a: string[], b: string[]) => a.slice(0, Math.min(a.length, b.length)).every((p, i) => p === b[i]);

/** Only GET object_info requests: no prompt validation endpoint, uploads, node installation or submissions. */
export async function preflightComfyPlan(plan: Plan, options: { url?: URL | null; signal?: AbortSignal; deferredInputs?: Record<string, string[]> } = {}): Promise<ComfyPreflight> {
  compilePlan(plan);
  const result: ComfyPreflight = { status: 'not-applicable', checkedAt: new Date().toISOString(), connection: null, classes: [], issues: [], limits };
  const steps = plan.nodes.filter(n => n.operation === 'comfy.workflow').map(step => ({ step, input: workflowInput.parse(step.input), bindings: (step.bindings ?? []).map(b => pointerParts(b.target)), missing: (options.deferredInputs?.[step.id] ?? []).map(pointerParts) }));
  if (!steps.length) return result;
  const deferred = (bindings: string[][], path: string[]) => bindings.some(b => overlaps(b, path));
  const classNames = [...new Set(steps.flatMap(({ input, bindings, missing }) => Object.entries(input.workflow).filter(([id]) => !deferred([...bindings, ...missing], ['workflow', id, 'class_type'])).map(([, node]) => node.class_type)))];
  let base: URL | null;
  try { base = options.url === undefined ? comfyWorkflowUrl() : options.url; }
  catch { base = null; }
  if (!base) {
    result.status = 'unavailable'; result.classes = classNames.map(name => ({ name, status: 'unavailable' }));
    result.issues.push({ step: '', node: '', classType: '', severity: 'deferred', message: 'Connect a ComfyUI server in Runs → Connections, or configure VIRAL_HIT_COMFYUI_URL, to inspect installed nodes.' });
    return result;
  }
  result.connection = connectionHash(base);
  const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(12_000)]) : AbortSignal.timeout(12_000);
  const schemas = new Map<string, Record<string, any>>();
  const states = new Map<string, 'available' | 'missing' | 'unavailable'>();
  let totalBytes = 0, cursor = 0;
  async function inspect(name: string) {
    if (name === '.' || name === '..') { states.set(name, 'unavailable'); return; }
    if (totalBytes >= 8_000_000 || signal.aborted) { states.set(name, 'unavailable'); return; }
    try {
      const response = await fetch(new URL(`object_info/${encodeURIComponent(name)}`, base!), { redirect: 'error', signal });
      if (!response.ok) { await response.body?.cancel(); throw new Error('Schema request failed'); }
      const reader = response.body?.getReader(); if (!reader) throw new Error('Missing response');
      const chunks: Uint8Array[] = []; let size = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read(); if (done) break;
          size += value.length; totalBytes += value.length;
          if (size > 2_000_000 || totalBytes > 8_000_000) throw new Error('Schema response exceeds inspection limit');
          chunks.push(value);
        }
      } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
      const data = JSON.parse(Buffer.concat(chunks, size).toString('utf8'));
      if (!isRecord(data)) throw new Error('Invalid schema response');
      if (!Object.hasOwn(data, name)) { states.set(name, 'missing'); return; }
      const schema = data[name];
      if (!isRecord(schema) || !isRecord(schema.input) || !Array.isArray(schema.output)) throw new Error('Invalid node schema');
      schemas.set(name, schema); states.set(name, 'available');
    } catch { states.set(name, 'unavailable'); }
  }
  await Promise.all(Array.from({ length: Math.min(4, classNames.length) }, async () => { while (cursor < classNames.length) { const name = classNames[cursor++]; await inspect(name); } }));
  result.classes = classNames.map(name => ({ name, status: states.get(name)! }));
  for (const { step, input, bindings, missing } of steps) {
    for (const [id, node] of Object.entries(input.workflow)) {
      const add = (severity: PreflightIssue['severity'], message: string, field?: string, extra: Partial<PreflightIssue> = {}) => result.issues.push({ step: step.id, node: id, classType: node.class_type, ...(field ? { input: field } : {}), severity, message, ...extra });
      if (deferred([...bindings, ...missing], ['workflow', id, 'class_type'])) { add('deferred', 'Node class is not known yet and cannot be inspected.'); continue; }
      if (states.get(node.class_type) === 'missing') { add('issue', `Node class ${node.class_type} is not reported by this server.`); continue; }
      const schema = schemas.get(node.class_type);
      if (!schema) { add('deferred', `Could not read the schema for ${node.class_type}; its availability is unknown.`); continue; }
      const required = isRecord(schema.input.required) ? schema.input.required : {};
      const optional = isRecord(schema.input.optional) ? schema.input.optional : {};
      for (const field of new Set([...Object.keys(required), ...Object.keys(node.inputs)])) {
        if (deferred(bindings, ['workflow', id, 'inputs', field])) { add('deferred', 'Input comes from an earlier step and will be checked by ComfyUI at execution.', field); continue; }
        if (!Object.hasOwn(node.inputs, field)) { add('issue', 'Required input is missing from the graph.', field); continue; }
        const value = node.inputs[field], spec = required[field] ?? optional[field];
        if (deferred(missing, ['workflow', id, 'inputs', field])) {
          const rawChoices = Array.isArray(spec?.[0]) ? spec[0] : undefined;
          const choices = rawChoices?.filter((choice: unknown) => ['string', 'number', 'boolean'].includes(typeof choice));
          add(rawChoices?.length === 0 ? 'issue' : 'deferred', rawChoices?.length === 0 ? 'The server currently reports no available choices for this input.' : 'No value selected yet; choose one before execution.', field, choices ? { choices: choices.slice(0, 20), choiceCount: rawChoices!.length } : {});
          continue;
        }
        if (Array.isArray(value) && value.length === 2 && typeof value[0] === 'string' && Number.isInteger(value[1])) {
          const source = input.workflow[value[0]];
          if (!source) add('issue', `Linked node ${value[0]} does not exist.`, field);
          else {
            if (deferred([...bindings, ...missing], ['workflow', value[0], 'class_type'])) { add('deferred', 'Linked node class is not known yet.', field); continue; }
            const sourceSchema = schemas.get(source.class_type);
            if (sourceSchema && (Number(value[1]) < 0 || Number(value[1]) >= sourceSchema.output.length)) add('issue', `Linked output index ${value[1]} is not reported by node ${value[0]}.`, field);
          }
          continue;
        }
        if (!Array.isArray(spec)) { add('deferred', 'This input has no inspectable schema; custom node validation may apply.', field); continue; }
        const type = spec[0], config = isRecord(spec[1]) ? spec[1] : {};
        if (Array.isArray(type)) {
          if (!type.every(choice => ['string', 'number', 'boolean'].includes(typeof choice))) { add('deferred', 'Structured choices require custom node validation.', field); continue; }
          if (!type.some(choice => choice === value)) {
            const choices = type.filter(choice => ['string', 'number', 'boolean'].includes(typeof choice));
            add('issue', type.length ? 'Value is not among the choices currently reported by the server.' : 'The server currently reports no available choices for this input.', field, { choices: choices.slice(0, 20), choiceCount: type.length });
          }
        } else if (['INT', 'FLOAT'].includes(type)) {
          if (typeof value !== 'number' || !Number.isFinite(value) || (type === 'INT' && !Number.isInteger(value)) || (typeof config.min === 'number' && value < config.min) || (typeof config.max === 'number' && value > config.max)) add('issue', 'Value does not match the numeric type or range reported by the server.', field);
        } else if ((type === 'STRING' && typeof value !== 'string') || (type === 'BOOLEAN' && typeof value !== 'boolean')) add('issue', `Value does not match the reported ${type} type.`, field);
        else if (!['STRING', 'BOOLEAN', 'INT', 'FLOAT'].includes(type)) add('deferred', 'Custom input semantics require the server’s execution-time validation.', field);
      }
    }
  }
  result.status = result.issues.some(i => i.severity === 'issue') ? 'issues' : !classNames.length || result.classes.some(c => c.status === 'unavailable') ? 'unavailable' : 'checked';
  return result;
}
