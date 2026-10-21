import { readGenerationIntentReceipt } from '@/core/effects/generation-intent-receipt';
import { toProjectGenerationItem } from '@/core/effects/project-generations';
import { getProject } from '@/core/projects/projects';

/** A local ledger observation is not proof that a failed or interrupted provider did no work. */
export async function inspectAssetGeneration({ projectId, generationIntentToken }: {
  projectId: string; generationIntentToken: string;
}) {
  const project = await getProject({ projectId });
  if (!project || project.status !== 'active') throw Error('Project not found');
  const { intent, generation } = await readGenerationIntentReceipt({ projectId, intentId: generationIntentToken });
  const awaitingReceipt = Boolean(generation && !generation.providerTaskId && generation.status !== 'succeeded');
  return {
    projectId, generationIntentToken,
    intentStatus: intent.status,
    expired: intent.expiresAt <= new Date(),
    generation: generation ? toProjectGenerationItem(generation) : null,
    hasProviderTask: Boolean(generation?.providerTaskId),
    submissionUnresolved: awaitingReceipt || (!generation && ['submitting', 'failed', 'consumed'].includes(intent.status)),
    mayResubmit: false as const,
    observationOnly: true as const,
  };
}
