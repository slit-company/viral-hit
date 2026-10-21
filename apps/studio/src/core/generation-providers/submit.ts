import { resolveModelOptions } from './model-controls';
import { prepareLocalGenerationReferences } from './local-media.server';
import { readFile, stat } from 'node:fs/promises';

import {
  normalizeAssetFirstGenerationRequest,
  type AssetFirstGenerationRequest,
} from '@/core/commands/generation-contract';
import { compileAssetFirstGenerationInput } from '@/core/commands/generation-compiler';
import {
  claimGenerationUploadSlot,
  completeGenerationUploadSlot,
  failGenerationUploadIntent,
  issueGenerationUploadIntent,
  releaseGenerationUploadSlot,
  getGenerationUploadIntentEffectId,
  getGenerationUploadIntentAdmissionState,
} from '@/core/effects/generation-upload-intent';
import { submitEffectGeneration } from '@/core/effects/submit-generation';
import { resolveLocalProjectAssetPath } from '@/core/projects/local-project-assets';
import {
  getProjectAssetById,
  linkGenerationAsset,
} from '@/core/workspace-lib/assets/user-assets';
import { uploadManagedGenerationInput } from '@/core/workspace-storage/managed-generation-input';
import { getProject } from '@/core/projects/projects';
import { getGenerationPromptConstraints, validateGenerationPrompt } from '@/core/effects/validation';

import {
  getGenerationModelDescriptor,
  validateGenerationModelInput,
} from './model-catalog';
import {
  getGenerationProvider,
} from './registry';
import { findGenerationModelBinding } from './catalog';
import {
  getProviderGenerationAssetUrl,
  needsManagedGenerationReferenceUpload,
} from './reference-delivery';

const getReferenceContentType = (asset: {
  type: 'image' | 'video' | 'audio';
  mimeType: string | null;
}) => {
  if (asset.mimeType?.trim()) return asset.mimeType.split(';')[0].trim();
  if (asset.type === 'video') return 'video/mp4';
  if (asset.type === 'audio') return 'audio/mpeg';
  return 'image/png';
};

async function prepareGenerationReferences({
  generation,
  intentId,
}: {
  generation: AssetFirstGenerationRequest;
  intentId: string;
}) {
  const assets = new Map<
    string,
    NonNullable<Awaited<ReturnType<typeof getProjectAssetById>>>
  >();
  for (const reference of generation.references) {
    if (assets.has(reference.assetId)) continue;
    const asset = await getProjectAssetById({
      projectId: generation.projectId,
      assetId: reference.assetId,
    });
    if (!asset) {
      throw new Error(
        `Asset ${reference.assetId} does not belong to this project.`
      );
    }
    assets.set(reference.assetId, asset);
  }

  const localAssets = [...assets.values()].filter(
    needsManagedGenerationReferenceUpload
  );
  const deliveryUrls = new Map<string, string>();
  for (const asset of assets.values()) {
    const providerUrl = getProviderGenerationAssetUrl(asset);
    if (providerUrl) deliveryUrls.set(asset.id, providerUrl);
  }
  for (const asset of localAssets) {
    if (asset.storageProvider !== 'local') {
      throw new Error(
        `Asset ${asset.id} does not have a public delivery URL or a readable local file.`
      );
    }
    const filePath = resolveLocalProjectAssetPath({ objectKey: asset.objectKey });
    const fileInfo = await stat(filePath);
    if (!fileInfo.isFile()) {
      throw new Error(`Local file for asset ${asset.id} is unavailable.`);
    }
    const slotId = await claimGenerationUploadSlot({
      intentId,
      projectId: generation.projectId,
    });
    if (!slotId) {
      throw new Error('Generation upload authorization is invalid or expired.');
    }
    try {
      const contentType = getReferenceContentType(asset);
      const bytes = await readFile(filePath);
      const body = new Blob([bytes], { type: contentType });
      const uploaded = await uploadManagedGenerationInput({
        body,
        filename: asset.filename || `${asset.id}.${asset.type}`,
        contentType,
      });
      const completed = await completeGenerationUploadSlot({
        intentId,
        upload: {
          slotId,
          provider: uploaded.provider,
          bucket: uploaded.bucket,
          key: uploaded.key,
          url: uploaded.url,
          filename: asset.filename || `${asset.id}.${asset.type}`,
          mimeType: contentType,
          sizeBytes: body.size,
        },
      });
      if (!completed) {
        throw new Error(
          'Generation upload authorization expired before completion.'
        );
      }
      deliveryUrls.set(asset.id, uploaded.url);
    } catch (error) {
      await releaseGenerationUploadSlot({ intentId, slotId }).catch(
        () => undefined
      );
      throw error;
    }
  }

  return {
    generation: {
      ...generation,
      references: generation.references.map((reference) => ({
        ...reference,
        ...(deliveryUrls.has(reference.assetId)
          ? { deliveryUrl: deliveryUrls.get(reference.assetId) }
          : {}),
      })),
    },
    authorizedDeliveryUrls: [...deliveryUrls.values()],
  };
}

export async function preflightAssetFirstGeneration(source: unknown) {
  let generation = normalizeAssetFirstGenerationRequest(source);
  const project = await getProject({ projectId: generation.projectId });
  if (!project || project.status !== 'active') throw new Error('Project not found');
  // The active provider or an installed one may serve the model.
  const found = findGenerationModelBinding({ modelId: generation.modelId });
  const provider = found && getGenerationProvider(found.providerId);
  if (!found || !provider) {
    throw new Error(`Model ${generation.modelId} is not available.`);
  }
  const { binding } = found;
  if (binding.controls || generation.parameters.provider_options !== undefined) generation = { ...generation, parameters: { ...generation.parameters, provider_options: resolveModelOptions(binding.controls, generation.parameters.provider_options) } };
  const descriptor = getGenerationModelDescriptor(generation.modelId);
  if (!descriptor || descriptor.kind !== generation.mode) {
    throw new Error(
      `Model ${generation.modelId} does not support ${generation.mode} generation.`
    );
  }
  const prompt = validateGenerationPrompt(generation.prompt, getGenerationPromptConstraints({ modelId: descriptor.kind === 'analysis' ? 'video-analysis' : generation.modelId }));
  if (!prompt.ok) throw new Error(prompt.code === 'PROMPT_TOO_LONG' ? `Prompt must be ${prompt.maxChars} characters or fewer.` : 'Prompt is required.');
  if (provider.referenceDelivery === 'project-media') {
    const preparedReferences = await prepareLocalGenerationReferences(generation);
    const input = await compileAssetFirstGenerationInput({ ...preparedReferences, generationIntentId: '' });
    validateGenerationModelInput({ modelId: generation.modelId, input });
    await provider.assertConfigured?.();
    return { generation, binding, expectedUploadCount: 0, preparedReferences };
  }
  const uniqueAssets = new Map<
    string,
    Awaited<ReturnType<typeof getProjectAssetById>>
  >();
  for (const reference of generation.references) {
    if (!uniqueAssets.has(reference.assetId)) {
      uniqueAssets.set(
        reference.assetId,
        await getProjectAssetById({
          projectId: generation.projectId,
          assetId: reference.assetId,
        })
      );
    }
  }
  const expectedUploadCount = [...uniqueAssets.values()].filter(
    (asset) => asset && needsManagedGenerationReferenceUpload(asset)
  ).length;
  const validationUrls: string[] = [];
  for (const [assetId, asset] of uniqueAssets) {
    if (!asset) throw new Error(`Asset ${assetId} does not belong to this project.`);
    if (needsManagedGenerationReferenceUpload(asset)) {
      if (asset.storageProvider !== 'local') throw new Error(`Asset ${assetId} is unavailable.`);
      const file = await stat(resolveLocalProjectAssetPath({ objectKey: asset.objectKey }));
      if (!file.isFile()) throw new Error(`Local file for asset ${assetId} is unavailable.`);
    }
  }
  // Validation uses inert URLs; no file leaves the workspace during preflight.
  const validationRequest = {
    ...generation,
    references: generation.references.map((reference, index) => {
      const asset = uniqueAssets.get(reference.assetId)!;
      const extension = asset.type === 'video' ? 'mp4' : asset.type === 'audio' ? 'mp3' : 'png';
      const deliveryUrl = `https://validation.invalid/reference-${index}.${extension}`;
      validationUrls.push(deliveryUrl);
      return { ...reference, deliveryUrl };
    }),
  };
  const input = await compileAssetFirstGenerationInput({ generation: validationRequest, generationIntentId: '', authorizedDeliveryUrls: validationUrls });
  validateGenerationModelInput({ modelId: generation.modelId, input });
  await provider.assertConfigured?.();
  return { generation, binding, expectedUploadCount, preparedReferences: undefined };
}

export async function createAssetFirstGenerationIntent(source: unknown) {
  const prepared = await preflightAssetFirstGeneration(source);
  return issueGenerationUploadIntent({
    projectId: prepared.generation.projectId,
    effectId: prepared.binding.effectId,
    expectedUploadCount: prepared.expectedUploadCount,
  });
}

export async function submitAssetFirstGeneration({
  generation: source,
  origin,
  generationIntentId,
  refreshExpiredIntent = true,
  backgroundPolling = true,
  expectedRuntimeIdentity,
  executionSignal,
}: {
  generation: AssetFirstGenerationRequest | unknown;
  origin: 'ui' | 'mcp' | 'cli' | 'system';
  generationIntentId?: string;
  refreshExpiredIntent?: boolean;
  backgroundPolling?: boolean;
  expectedRuntimeIdentity?: string;
  executionSignal?: AbortSignal;
}) {
  const { generation, binding, expectedUploadCount, preparedReferences } = await preflightAssetFirstGeneration(source);
  const intentId = generationIntentId || await issueGenerationUploadIntent({
    projectId: generation.projectId,
    effectId: binding.effectId,
    expectedUploadCount,
  });
  if (await getGenerationUploadIntentEffectId({ intentId, projectId: generation.projectId }) !== binding.effectId) {
    throw new Error('Generation authorization does not match this project and model.');
  }
  const admission = await getGenerationUploadIntentAdmissionState({ intentId, projectId: generation.projectId, effectId: binding.effectId });
  if (admission.status === 'used') return { status: 409, body: {
    code: 'GENERATION_ALREADY_SUBMITTED', error: 'This generation was already submitted. Inspect its original receipt before taking further action.',
  } };
  try {
    const prepared = preparedReferences ?? await prepareGenerationReferences({
      generation,
      intentId,
    });
    const input = await compileAssetFirstGenerationInput({
      generation: prepared.generation,
      generationIntentId: intentId,
      authorizedDeliveryUrls: prepared.authorizedDeliveryUrls,
    });
    validateGenerationModelInput({ modelId: generation.modelId, input });
    const result = await submitEffectGeneration({
      effectId: binding.effectId,
      input,
      projectId: generation.projectId,
      generationIntentId: intentId,
      refreshExpiredIntent,
      backgroundPolling,
      expectedRuntimeIdentity,
      executionSignal,
      authorizedReferenceUrls: prepared.authorizedDeliveryUrls,
      metadata: {
        origin,
        requestVersion: generation.version,
        logicalModelId: generation.modelId,
      },
    });
    const generationId =
      typeof result.body.wmTaskId === 'string' ? result.body.wmTaskId : null;
    if (result.status < 400 && generationId) {
      for (const assetId of new Set(
        generation.references.map((reference) => reference.assetId)
      )) {
        await linkGenerationAsset({
          generationId,
          assetId,
          role: 'input',
        });
      }
    }
    return result;
  } catch (error) {
    // A competing submit may own the claim; preparation failure cannot retire its in-flight intent.
    await failGenerationUploadIntent({ intentId, pendingOnly: true });
    throw error;
  }
}
