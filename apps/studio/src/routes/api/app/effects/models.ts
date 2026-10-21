import { createFileRoute } from '@tanstack/react-router';
import { resolveWorkspaceEffectProviderModelVariant } from '@/core/effects/effect-registry';
import { getGenerationModelDescriptor, listGenerationModelDescriptors } from '@/core/generation-providers/model-catalog';
import {
  type WorkspaceType,
  getWorkspaceModelsByType,
} from '@/core/effects/workspace-models';

const isWorkspaceType = (value: string | null): value is WorkspaceType =>
  value === 'ai-image' || value === 'ai-video';

async function GET({ request }: { request: Request }) {
  const { searchParams } = new URL(request.url);
  const requestedType = searchParams.get('type');
  const types = isWorkspaceType(requestedType)
    ? [requestedType]
    : (['ai-image', 'ai-video'] as const);

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
      inputSchema: descriptor?.parameterSchema ?? null,
      defaultProviderModelVariant: model.defaultVariant
        ? resolveWorkspaceEffectProviderModelVariant({
            modelId: model.id,
            variant: model.defaultVariant,
          })
        : null,
      available: descriptor?.available ?? true,
    };
  });

  const analysisModels = listGenerationModelDescriptors().filter(model => model.kind === 'analysis').map(model => ({
    id: model.id, name: model.name, available: model.available, workspaceType: 'analysis',
    uploadPath: '', imageBucketName: '', supportsSourceVideo: true, maxSourceVideos: 1,
    inputSchema: model.parameterSchema, defaultProviderModelVariant: null,
  }));
  return Response.json({ models: requestedType === 'analysis' ? analysisModels : requestedType ? models : [...models, ...analysisModels] });
}

export const Route = createFileRoute('/api/app/effects/models')({
  server: {
    handlers: { GET },
  },
});
