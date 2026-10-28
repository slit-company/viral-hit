import test from 'node:test';
import assert from 'node:assert/strict';
import { readInspectionReport } from './report';
const report = { schemaVersion: 1, kind: 'viral-hit-app-inspection', projectId: 'p', receiptId: 'a'.repeat(64), targetId: 'app', targetLabel: '<script>untrusted</script>', targetKind: 'website', question: 'Search behavior', engine: { name: 'REA', version: '6.8.0' }, capturedAt: '2026-10-28T00:00:00Z', status: 'partial', evidence: [{ id: 'ev_'+'b'.repeat(64), operation: 'inspect_web_page', sha256: 'c'.repeat(64), file: 'page.json' }], facts: [{ kind: 'page', label: 'Captured', source: 'source', status: 'observed' }], limitations: ['Bundle analysis timed out'], nextSteps: ['Verify behavior'] };
test('inspection reports preserve partial status and reject malformed, oversized or unrelated output',()=>{
  assert.deepEqual(readInspectionReport(JSON.stringify(report)),report);
  assert.deepEqual(readInspectionReport(JSON.stringify({...report,privateData:'excluded',facts:[{...report.facts[0],raw:'excluded'}]})),report);
  for(const value of [{...report,status:'complete'},{...report,targetKind:['website']},{...report,status:['partial']},{...report,evidence:[]},{...report,facts:[{...report.facts[0],status:['observed']}]},{...report,facts:[{...report.facts[0],status:'verified'}]},{...report,evidence:[{...report.evidence[0],sha256:'wrong'}]},{...report,question:'x'.repeat(2001)}]) assert.equal(readInspectionReport(JSON.stringify(value)),null);
  assert.equal(readInspectionReport('{'),null);assert.equal(readInspectionReport('x'.repeat(131073)),null);assert.equal(readInspectionReport('{"kind":"image"}'),null);
});
