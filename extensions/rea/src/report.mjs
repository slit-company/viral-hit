import { hash, REA_VERSION } from './config.mjs';

const text = (value, max = 500) => typeof value === 'string' ? value.slice(0, max) : '';
const safeUrl = value => { try { const url = new URL(value); return url.origin + url.pathname; } catch { return text(value).split('?')[0]; } };
export function validateEvidence(value, operation) {
  if (!value || value.operation !== operation || !/^ev_[a-f0-9]{64}$/.test(value.evidence_id ?? '') || !value.normalized_result || typeof value.normalized_result !== 'object' || Array.isArray(value.normalized_result)) throw Error('REA returned an unexpected evidence contract');
  return value;
}
/** Small public projection; complete observations stay in the private Evidence files. */
export function report({ input, target, projectId, receiptId, evidence, failure }) {
  const facts = [], limitations = new Set(['Static candidates do not establish runtime behavior or backend implementation.']);
  let omitted = 0, partial = Boolean(failure);
  const add = (kind, label, source, status = 'observed') => {
    if (!label) return;
    if (facts.length === 80) { omitted++; return; }
    facts.push({ kind: text(kind, 60), label: text(label), source: text(source, 250), status: status === 'observed' ? 'observed' : 'inferred' });
  };
  for (const { value } of evidence) {
    const result = value.normalized_result;
    if (result.completeness?.status && result.completeness.status !== 'complete') {
      partial = true;
      limitations.add('REA capture coverage: ' + text(result.completeness.status, 100) + '. See the original coverage record for excluded or unavailable sections.');
    }
    for (const item of [...(value.limitations ?? []), ...(result.limitations ?? [])]) if (typeof item === 'string') limitations.add(text(item, 1000));
    if (value.operation === 'analyze_javascript_application') {
      for (const node of result.graph?.nodes ?? []) {
        for (const observation of node.observations ?? []) {
          const location = observation.evidence?.location?.value;
          const source = location?.source ? `${location.source}:${location.start?.line ?? '?'}` : value.evidence_id;
          add(node.kind, observation.label, source, observation.evidence?.state);
        }
      }
      limitations.add('Module relationships describe only the selected application artifact and retained source coverage.');
    } else if (value.operation === 'analyze_web_bundle') {
      for (const item of result.observations?.chunks?.nodes ?? []) add('script', safeUrl(item.url), item.artifact_sha256);
      for (const item of result.observations?.endpoints ?? []) add('endpoint candidate', safeUrl(item.value), `${item.location?.script_key ?? value.evidence_id}:${item.location?.line ?? '?'}`, 'inferred');
      for (const item of result.route_inventory?.routes ?? []) add('route candidate', item.path ?? item.pattern, item.id ?? value.evidence_id, 'inferred');
      if (result.completeness?.status !== 'complete') limitations.add('REA reports incomplete captured-script analysis. Inspect the retained coverage record.');
    } else if (value.operation === 'inspect_web_page') {
      add('page observation', 'DOM, accessibility, script and attach-window network metadata retained', value.evidence_id);
      const links = new Set();
      for (const item of result.metadata?.dom_urls ?? []) {
        if (item.attribute !== 'href' || item.destination_scope !== 'approved' || !item.url) continue;
        const label = safeUrl(item.url);
        if (links.has(label)) continue;
        links.add(label);
        if (links.size <= 40) add('page link', label, value.evidence_id + ':DOM node ' + item.node_index);
        else omitted++;
      }
      if (result.accessibility?.text_capture?.status === 'not_approved') limitations.add('Accessible names and descriptions were not captured; links and structural roles alone do not establish feature behavior.');
      limitations.add('Browser observation covers one selected target and its bounded observation window; earlier traffic may be absent.');
    }
  }
  if (failure) limitations.add(failure);
  if (omitted) limitations.add(`${omitted} additional observations omitted from this summary; retained Evidence contains the full result.`);
  const allLimits = [...limitations];
  if (allLimits.length > 30) allLimits.splice(29, Infinity, 'Additional limitations are retained in the private Evidence files.');
  const output = { schemaVersion: 1, kind: 'viral-hit-app-inspection', projectId, receiptId, targetId: target.id, targetLabel: target.label, targetKind: target.kind,
    question: input.question, engine: { name: 'REA', version: REA_VERSION }, capturedAt: new Date().toISOString(), status: partial ? 'partial' : 'recorded',
    evidence: evidence.map(({ value, bytes, file }) => ({ id: value.evidence_id, operation: value.operation, sha256: hash(bytes), file })), facts, limitations: allLimits,
    nextSteps: ['Select the observations relevant to the research question and cite their evidence locations.', 'Separate observed behavior, static candidates and unresolved questions in the feature map.', 'Define an input/output contract and behavior checks before implementing a replacement.'] };
  if (Buffer.byteLength(JSON.stringify(output)) > 96000) {
    output.limitations.unshift('This summary was shortened to its UTF-8 byte budget. Full findings and limitations remain in the private Evidence files.');
    output.limitations = output.limitations.slice(0, 30);
    while (Buffer.byteLength(JSON.stringify(output)) > 96000 && output.facts.length) output.facts.pop();
    while (Buffer.byteLength(JSON.stringify(output)) > 96000 && output.limitations.length > 1) output.limitations.pop();
  }
  return output;
}
