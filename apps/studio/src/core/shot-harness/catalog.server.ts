import { getGenerationModelDescriptor } from '../generation-providers/model-catalog';
import { getWorkspaceModelsByType } from '../effects/workspace-models';
import { creditsAddedTimes, providerBalances } from '../generation-providers/installed/balance.server';
import { recentGenerationOutcomes } from '../generation-providers/recent-outcomes.server';
import { serviceCredit, serviceHealth } from '../generation-providers/service-credit';
import type { ShotModel } from './spec';

/**
 * Connected image and video models with the facts routing needs, from the same catalog Studio uses.
 * Previews use cached balances (stale ones refresh in the background); a paid submission waits for a
 * balance no older than a minute.
 */
export async function listShotModels({ freshBalances = false }: { freshBalances?: boolean } = {}): Promise<ShotModel[]> {
  const [outcomes, creditsAdded, balances] = await Promise.all([
    recentGenerationOutcomes(), creditsAddedTimes(), providerBalances({ wait: freshBalances, maxAgeMs: freshBalances ? 60_000 : 120_000 }),
  ]);
  const health = serviceHealth(outcomes, creditsAdded);
  return (['ai-image', 'ai-video'] as const).flatMap(type => getWorkspaceModelsByType(type).flatMap(model => {
    const descriptor = getGenerationModelDescriptor(model.id);
    if (!descriptor || descriptor.providerId === 'cloud-api') return [];
    const credit = serviceCredit(balances.get(descriptor.providerId), health.get(descriptor.providerId));
    return [{
      id: model.id, name: model.name, providerId: descriptor.providerId, providerLabel: descriptor.providerLabel,
      kind: type === 'ai-image' ? 'image' as const : 'video' as const, studioTasks: [...(descriptor.studioTasks ?? [])],
      referenceInputs: descriptor.referenceInputs, supportedDurations: model.supportedDurations ? [...model.supportedDurations] : undefined,
      videoImageInputs: descriptor.videoImageInputs,
      supportedAspectRatios: model.supportedAspectRatios ? [...model.supportedAspectRatios] : undefined,
      controls: descriptor.controls as ShotModel['controls'], available: descriptor.available,
      ...(health.has(descriptor.providerId) ? { health: health.get(descriptor.providerId) } : {}),
      ...(credit ? { credit } : {}),
    }];
  }));
}
