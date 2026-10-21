import { and, eq } from 'drizzle-orm';
import { generationAssetLink, userAsset } from '@/config/db/schema';
import { getDb } from '../workspace-lib/db-adapter';
import { getProjectAssetById } from '../workspace-lib/assets/user-assets';
import { resolveLocalProjectAssetPath } from '../projects/local-project-assets';
import { analysisReport } from '../generation-providers/analysis-report';
import { verifyProjectMediaInput } from './project-media-input';
import { MAX_ADAPTER_INPUT_BYTES } from './project-media-input-schema';
import { probeMedia } from './probe-media';
import type { GenerationModelInput } from './generation-contract';
import type { Json } from './durable';

/** Reuse retained outputs; never download or create a second materializer copy. */
export async function generationJobOutput(input: GenerationModelInput, generation: { id: string; output: unknown }, signal: AbortSignal): Promise<Json> {
  if (!input.runtime) throw Error('Missing generation identity');
  const output = generation.output && typeof generation.output === 'object' ? generation.output as Record<string, unknown> : {};
  if (input.mode === 'analysis') {
    if (input.outputIndex !== 0) throw Error('Analysis has a single report output');
    const report = output.analysis_report === undefined ? undefined : analysisReport.parse(output.analysis_report);
    const text = typeof output.analysis_text === 'string' ? output.analysis_text : report?.summary;
    if (!text || text.length > 128_000) throw Error('Analysis result is missing or exceeds the text limit');
    return { generationId: generation.id, kind: 'analysis', text, ...(report ? { report: report as Json } : {}) };
  }
  const db = await getDb();
  const links = await db.select({ assetId: generationAssetLink.assetId }).from(generationAssetLink).where(and(
    eq(generationAssetLink.generationId, generation.id), eq(generationAssetLink.role, 'output'),
  ));
  const ownedOutputs = new Set(links.map((link: { assetId: string }) => link.assetId));
  if (!Array.isArray(output.assetIds) || output.assetIds.length > 16) throw Error('Generation has no bounded retained output identities');
  const ids = [...new Set(output.assetIds.filter((id): id is string => typeof id === 'string' && ownedOutputs.has(id)))];
  const assetId = ids[input.outputIndex];
  if (!assetId) throw Error('Selected generation output does not exist');
  const projectId = input.runtime.projectId;
  const asset = await getProjectAssetById({ projectId, assetId });
  if (!asset || asset.type !== input.mode) throw Error('Generated output is not owned by this project or has the wrong media kind');
  const checked = await verifyProjectMediaInput({ projectId, assetId, kind: input.mode, maxBytes: MAX_ADAPTER_INPUT_BYTES, signal });
  const info = await probeMedia(resolveLocalProjectAssetPath({ objectKey: asset.objectKey }), input.mode, signal);
  await verifyProjectMediaInput({ projectId, assetId, kind: input.mode, expected: checked, maxBytes: MAX_ADAPTER_INPUT_BYTES, signal });
  // Derived measurements only. Original bytes, URLs, generation links and metadata remain intact.
  const updated = await db.update(userAsset).set({ width: info.width, height: info.height, durationMs: info.durationMs, mimeType: info.mimeType })
    .where(and(eq(userAsset.id, assetId), eq(userAsset.sha256, checked.sha256), eq(userAsset.type, input.mode)))
    .returning({ id: userAsset.id });
  if (updated.length !== 1) throw Error('Generated asset changed during inspection');
  return { generationId: generation.id, assetId, projectId, publicUrl: asset.publicUrl, kind: input.mode,
    sha256: checked.sha256, sizeBytes: checked.sizeBytes, mimeType: info.mimeType, width: info.width,
    height: info.height, durationMs: info.durationMs, mediaMaterialized: true };
}
