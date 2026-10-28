export type InspectionReport = {
  schemaVersion: 1; kind: 'viral-hit-app-inspection'; projectId: string; receiptId: string;
  targetId: string; targetLabel: string; targetKind: 'website' | 'javascript'; question: string;
  engine: { name: 'REA'; version: string }; capturedAt: string; status: 'recorded' | 'partial';
  evidence: { id: string; operation: string; sha256: string; file: string }[];
  facts: { kind: string; label: string; source: string; status: 'observed' | 'inferred' }[];
  limitations: string[]; nextSteps: string[];
};
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.length <= max;
const digest = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const oneOf = (value: unknown, choices: string[]) => typeof value === 'string' && choices.includes(value);
const list = (value: unknown, max: number, valid: (item: unknown) => boolean) => Array.isArray(value) && value.length <= max && value.every(valid);

/** Keep untrusted extension output out of presentation unless the bounded contract matches. */
export function readInspectionReport(raw: string | null): InspectionReport | null {
  if (!raw || raw.length > 131072) return null;
  let value: unknown; try { value = JSON.parse(raw); } catch { return null; }
  if (!object(value) || value.schemaVersion !== 1 || value.kind !== 'viral-hit-app-inspection'
    || !text(value.projectId, 128) || !digest(value.receiptId) || !text(value.targetId, 128) || !text(value.targetLabel, 120)
    || !oneOf(value.targetKind, ['website', 'javascript']) || !text(value.question, 2000)
    || !object(value.engine) || value.engine.name !== 'REA' || !text(value.engine.version, 40)
    || !text(value.capturedAt, 50) || !Number.isFinite(Date.parse(value.capturedAt)) || !oneOf(value.status, ['recorded', 'partial'])
    || !list(value.evidence, 2, item => object(item) && text(item.id, 80) && /^ev_[a-f0-9]{64}$/.test(item.id) && text(item.operation, 100) && digest(item.sha256) && text(item.file, 100))
    || !Array.isArray(value.evidence) || value.evidence.length === 0
    || !list(value.facts, 80, item => object(item) && text(item.kind, 60) && text(item.label, 500) && text(item.source, 250) && oneOf(item.status, ['observed', 'inferred']))
    || !list(value.limitations, 30, item => text(item, 1000)) || !list(value.nextSteps, 10, item => text(item, 1000))) return null;
  const result = value as InspectionReport;
  return {
    schemaVersion: 1, kind: 'viral-hit-app-inspection', projectId: result.projectId, receiptId: result.receiptId,
    targetId: result.targetId, targetLabel: result.targetLabel, targetKind: result.targetKind, question: result.question,
    engine: { name: 'REA', version: result.engine.version }, capturedAt: result.capturedAt, status: result.status,
    evidence: result.evidence.map(({ id, operation, sha256, file }) => ({ id, operation, sha256, file })),
    facts: result.facts.map(({ kind, label, source, status }) => ({ kind, label, source, status })),
    limitations: result.limitations, nextSteps: result.nextSteps,
  };
}
