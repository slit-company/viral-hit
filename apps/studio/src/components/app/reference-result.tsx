import { readReferenceOutput } from '@/core/references/recipe-contract';

export function ReferenceResult({ projectId, output }: { projectId: string; output: string | null }) {
  const result = readReferenceOutput(output);
  if (!result || result.projectId !== projectId) return null;
  return <section aria-label="Reference frames" className="mt-3 border-t border-[var(--vh-border)] pt-3">
    <p className="mb-2 font-medium">Five reference frames</p>
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
      {result.reference.samples.map((sample, index) => <figure key={sample.assetId} className="min-w-0 overflow-hidden rounded-md border border-[var(--vh-border)] bg-[var(--vh-surface)]">
        <img src={`/api/app/projects/${encodeURIComponent(projectId)}/assets/${sample.assetId}`}
          alt={`Reference frame ${index + 1} at ${(sample.atMs / 1000).toFixed(2)} seconds`}
          loading="lazy" className="aspect-video w-full object-contain" />
        <figcaption className="px-1 py-1 text-center text-[10px] tabular-nums text-[var(--vh-text-2)]">{(sample.atMs / 1000).toFixed(2)}s</figcaption>
      </figure>)}
    </div>
  </section>;
}
