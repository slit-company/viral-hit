import type { ModelRequirements } from '@/core/harness/model-requirements';
import type { RecipePreflight } from '@/core/harness/recipe-preflight.server';

export function RecipeRequirementsReport({ report }: { report: ModelRequirements | RecipePreflight }) {
  const native = 'classes' in report;
  const title = native ? 'Server check' : 'Model requirements';
  return <div role="status" aria-label={native ? 'Server check result' : 'Model requirements'} className="max-h-44 space-y-2 overflow-y-auto rounded-lg border border-[var(--vh-border)] bg-[var(--vh-control)] p-3 text-xs">
    <p className="font-semibold">{report.status === 'not-applicable' ? 'No native workflow to check' : `${title}: ${report.status === 'issues' ? 'needs attention' : report.status === 'unavailable' ? 'unavailable' : 'no reported issues'}`}</p>
    {report.models?.map(model => <p key={model.step} className="break-words">{model.step} · {model.modelId} · {model.status}</p>)}
    {native && <p className="text-[var(--vh-text-2)]">{report.models?.length && !report.classes.length ? `${report.models.filter(model => model.status === 'available').length} models available` : `${report.classes.filter(item => item.status === 'available').length} node types available`} · {report.issues.filter(item => item.severity === 'deferred').length} checks deferred</p>}
    {report.issues.slice(0, 12).map((issue, index) => <div key={index} className="break-words"><p className="font-medium">{[issue.classType, issue.node && `#${issue.node}`, issue.input].filter(Boolean).join(' · ')}</p><p>{issue.severity === 'deferred' ? 'Deferred: ' : ''}{issue.message}</p>{issue.choices?.length ? <p className="mt-1 text-[var(--vh-text-2)]">Available: {issue.choices.slice(0, 5).join(', ')}{(issue.choiceCount ?? 0) > 5 ? ' …' : ''}</p> : null}</div>)}
    {report.issues.length > 12 && <p>{report.issues.length - 12} more checks in the CLI/MCP report.</p>}
    <p className="text-[var(--vh-text-2)]">{report.limits}</p>
    <p className="text-[var(--vh-text-2)]">No jobs or uploads started. This check does not guarantee successful execution.</p>
  </div>;
}
