import { getGenerationModelDescriptor } from '../generation-providers/model-catalog';
import { getWorkspaceModelsByType } from '../effects/workspace-models';
import type { ShotModel } from './spec';

/** Connected image and video models with the facts routing needs, from the same catalog Studio uses. */
export function listShotModels(): ShotModel[] {
  return (['ai-image', 'ai-video'] as const).flatMap(type => getWorkspaceModelsByType(type).flatMap(model => {
    const descriptor = getGenerationModelDescriptor(model.id);
    if (!descriptor || descriptor.providerId === 'cloud-api') return [];
    return [{
      id: model.id, name: model.name, providerId: descriptor.providerId, providerLabel: descriptor.providerLabel,
      kind: type === 'ai-image' ? 'image' as const : 'video' as const, studioTasks: [...(descriptor.studioTasks ?? [])],
      referenceInputs: descriptor.referenceInputs, supportedDurations: model.supportedDurations ? [...model.supportedDurations] : undefined,
      supportedAspectRatios: model.supportedAspectRatios ? [...model.supportedAspectRatios] : undefined,
      controls: descriptor.controls as ShotModel['controls'], available: descriptor.available,
    }];
  }));
}
