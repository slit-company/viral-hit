import { resolveModelOptions, type ModelControl } from './model-controls';
import { resolveAnalysisInputs, type AnalysisInputs } from './analysis-inputs';
import {
  getWorkspaceEffectRegistryEntry,
  type WorkspaceEffectRegistryEntry,
} from '@/core/effects/effect-registry';
import { getRegisteredEffectById } from '@/core/effects/registered-effects';
import { getWorkspaceMediaSchema } from '@/core/effects/workspace-media';

import { findGenerationModelBinding, listSelectableGenerationProviders } from './catalog';
import { getGenerationProvider } from './registry';

const defaultsFromEntry = (entry: WorkspaceEffectRegistryEntry) => ({
  ...(entry.defaultAspectRatio
    ? { aspect_ratio: entry.defaultAspectRatio }
    : {}),
  ...(entry.defaultDuration ? { wmDuration: entry.defaultDuration } : {}),
  ...(entry.defaultOutputQuality
    ? { wmOutputQuality: entry.defaultOutputQuality }
    : {}),
  ...(entry.defaultQuality ? { quality: entry.defaultQuality } : {}),
  ...(entry.defaultMode ? { mode: entry.defaultMode } : {}),
  ...(entry.defaultLanguage ? { language: entry.defaultLanguage } : {}),
  ...(entry.defaultCharacterOrientation
    ? { characterOrientation: entry.defaultCharacterOrientation }
    : {}),
  ...(entry.defaultBackgroundSource
    ? { backgroundSource: entry.defaultBackgroundSource }
    : {}),
});

export type GenerationModelDescriptor = {
  id: string;
  name: string;
  providerId: string;
  referenceDelivery?: 'project-media';
  kind: 'image' | 'video' | 'audio' | 'analysis';
  available: boolean;
  controls?: ModelControl[];
  analysisInputs?: AnalysisInputs;
  parameterSchema: unknown;
  defaultParameters: Record<string, unknown>;
  referenceSchema: unknown;
};

export function listGenerationModelDescriptors(): GenerationModelDescriptor[] {
  return listSelectableGenerationProviders().flatMap((provider) => provider.modelBindings.flatMap<GenerationModelDescriptor>((binding) => {
    const effect = getRegisteredEffectById(binding.effectId, provider.id);
    if (!effect) return [];
    if (effect.type === 3) {
      return [
        {
          id: binding.modelId,
          name: effect.name,
          providerId: provider.id,
          ...(provider.referenceDelivery ? { referenceDelivery: provider.referenceDelivery } : {}),
          kind: 'analysis' as const,
          ...(binding.analysisInputs ? { analysisInputs: binding.analysisInputs } : {}),
          available: getGenerationProvider(provider.id)?.isConfigured?.() !== false,
          ...(binding.controls ? { controls: binding.controls } : {}),
          parameterSchema: effect.inputSchema,
          defaultParameters: {
            analysis_depth: 'standard',
            max_output_tokens: 2048,
            ...(binding.controls ? { provider_options: resolveModelOptions(binding.controls, undefined) } : {}),
          },
          referenceSchema: resolveAnalysisInputs(binding.analysisInputs),
        },
      ];
    }
    const entry = getWorkspaceEffectRegistryEntry(binding.modelId);
    if (!entry) return [];
    return [
      {
        id: entry.id,
        name: entry.name,
        providerId: provider.id,
        ...(provider.referenceDelivery ? { referenceDelivery: provider.referenceDelivery } : {}),
        kind: entry.workspaceType === 'ai-image' ? ('image' as const) : entry.workspaceType === 'ai-audio' ? ('audio' as const) : ('video' as const),
        available: getGenerationProvider(provider.id)?.isConfigured?.() !== false,
        ...(binding.controls ? { controls: binding.controls } : {}),
        parameterSchema: effect.inputSchema,
        defaultParameters: { ...defaultsFromEntry(entry), ...(binding.controls ? { provider_options: resolveModelOptions(binding.controls, undefined) } : {}) },
        referenceSchema: getWorkspaceMediaSchema(entry.id),
      },
    ];
  }));
}

export function getGenerationModelDescriptor(modelId: string) {
  return (
    listGenerationModelDescriptors().find((model) => model.id === modelId) ??
    null
  );
}

export function validateGenerationModelInput({
  modelId,
  input,
}: {
  modelId: string;
  input: Record<string, unknown>;
}) {
  const found = findGenerationModelBinding({ modelId });
  const provider = found && getGenerationProvider(found.providerId);
  if (!found || !provider) throw new Error(`Model ${modelId} is not available.`);
  const { binding } = found;
  const effect = getRegisteredEffectById(binding.effectId, provider.id);
  if (!effect) throw new Error(`Model ${modelId} is not registered.`);
  provider.validateInput?.(effect, input);
  return { provider, binding, effect };
}
