import { getConfig } from '@/modules/config/service';
import { getCloudApiBaseUrl } from '@/core/generation-providers/cloud-api-endpoint.server';
import { createFileRoute } from '@tanstack/react-router';
import { resolveWorkspaceEffectProviderModelVariant } from '@/core/effects/effect-registry';
import { getGenerationModelDescriptor, listGenerationModelDescriptors } from '@/core/generation-providers/model-catalog';
import {
  type WorkspaceType,
  getWorkspaceModelsByType,
} from '@/core/effects/workspace-models';

const isWorkspaceType = (value: string | null): value is WorkspaceType =>
  value === 'ai-image' || value === 'ai-video' || value === 'ai-audio';

async function GET({ request }: { request: Request }) {
  const cloudReady = Boolean(getCloudApiBaseUrl() && await getConfig('CLOUD_API_KEY'));
  const available = (model: { providerId: string; available: boolean } | null | undefined) => model?.providerId === 'cloud-api' ? cloudReady : model?.available ?? false;
  const { searchParams } = new URL(request.url);
  const requestedType = searchParams.get('type');
  const types = isWorkspaceType(requestedType)
    ? [requestedType]
    : (['ai-image', 'ai-video', 'ai-audio'] as const);

  const registryModels = types.flatMap((type) =>
    getWorkspaceModelsByType(type).map((model) => ({
      ...model,
      workspaceType: type,
    }))
  );
  const models = registryModels.map((model) => {
    const descriptor = getGenerationModelDescriptor(model.id);

    return {
      ...model,
      providerId: descriptor?.providerId, providerLabel: descriptor?.providerLabel, studioTasks: descriptor?.studioTasks,
      inputSchema: descriptor?.parameterSchema ?? null,
      ...(descriptor?.controls ? { controls: descriptor.controls } : {}),
      ...(descriptor?.referenceInputs ? { referenceInputs: descriptor.referenceInputs } : {}),
      ...(descriptor?.maskInput ? { maskInput: descriptor.maskInput } : {}),
      ...(descriptor?.referenceRoles ? { referenceRoles: descriptor.referenceRoles } : {}),
      defaultProviderModelVariant: model.defaultVariant
        ? resolveWorkspaceEffectProviderModelVariant({
            modelId: model.id,
            variant: model.defaultVariant,
          })
        : null,
      available: available(descriptor),
    };
  });

  const analysisModels = listGenerationModelDescriptors().filter(model => model.kind === 'analysis').map(model => ({
    id: model.id, name: model.name, providerId: model.providerId, providerLabel: model.providerLabel, studioTasks: model.studioTasks, available: available(model), workspaceType: 'analysis',
    uploadPath: '', imageBucketName: '',
    ...(model.analysisInputs ? { analysisInputs: model.analysisInputs, maxReferenceImages: model.analysisInputs.image.max, maxSourceVideos: model.analysisInputs.video.max, maxReferenceAudios: model.analysisInputs.audio.max, supportsSourceVideo: model.analysisInputs.video.max > 0 } : { supportsSourceVideo: true, maxSourceVideos: 1 }),
    ...(model.controls ? { controls: model.controls } : {}), inputSchema: model.parameterSchema, defaultProviderModelVariant: null,
  }));
  return Response.json({ models: requestedType === 'analysis' ? analysisModels : requestedType ? models : [...models, ...analysisModels] });
}

export const Route = createFileRoute('/api/app/effects/models')({
  server: {
    handlers: { GET },
  },
});
