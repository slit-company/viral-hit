import { Action } from '@/components/base/action';
import { readInspectionReport, type InspectionReport } from '@/core/inspection/report';

function download(result: InspectionReport) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(result, null, 2) + '\n'], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = `inspection-${result.receiptId.slice(0, 12)}.json`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function InspectionResult({ projectId, output }: { projectId: string; output: string | null }) {
  const result = readInspectionReport(output);
  if (!result || result.projectId !== projectId) return null;
  return <section aria-label="App inspection report" className="mt-3 min-w-0 space-y-3 border-t border-[var(--vh-border)] pt-3">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0"><h3 className="break-words text-sm font-semibold">{result.targetLabel}</h3>
        <p className="text-xs text-[var(--vh-text-2)]">REA {result.engine.version} · {result.status === 'partial' ? 'Partial analysis' : 'Evidence recorded'}</p></div>
      <Action size="small" className="vh-secondary" onClick={() => download(result)}>Download report</Action>
    </div>
    <p className="whitespace-pre-wrap break-words text-xs leading-5">{result.question}</p>
    <p className="text-xs leading-5 text-[var(--vh-text-2)]">Observed structure and static candidates. Feature behavior and server implementation still need verification.</p>
    <details open className="min-w-0 rounded-lg border border-[var(--vh-border)] p-3">
      <summary className="cursor-pointer font-medium">Findings ({result.facts.length})</summary>
      <ul className="mt-2 max-h-56 space-y-3 overflow-auto">
        {result.facts.map((fact, index) => <li key={index} className="min-w-0 text-xs">
          <p className="break-words font-medium">{fact.label}</p>
          <p className="mt-1 break-words text-[var(--vh-text-2)]">{fact.kind} · {fact.status === 'observed' ? 'Observed' : 'Static candidate'}</p>
          <code className="mt-1 block break-all text-[10px] text-[var(--vh-text-2)]">{fact.source}</code>
        </li>)}
      </ul>
      {!result.facts.length && <p className="mt-2 text-xs">No findings retained in this summary. Check the evidence and coverage limits.</p>}
    </details>
    <details className="min-w-0"><summary className="cursor-pointer font-medium">Coverage and next steps</summary>
      <ul className="mt-2 list-disc space-y-2 pl-4 text-xs leading-5">{[...result.limitations, ...result.nextSteps].map((line, index) => <li key={index} className="break-words">{line}</li>)}</ul>
    </details>
    <p className="break-words text-[10px] leading-4 text-[var(--vh-text-2)]">Full evidence is retained privately under receipt {result.receiptId.slice(0, 12)}. The download contains this summary, not raw application files or browser data.</p>
  </section>;
}
