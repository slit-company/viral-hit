import { createReferenceAdapter } from '../references/recipe-adapters.server';
import { createExternalAdapters } from './external-adapters';
import type { Adapter } from './durable';
import { createComfyRouterAdapter } from './comfy-router';
import { createComfyWorkflowAdapter } from './comfy-workflow';
import { createMaterializeAdapter } from './materialize';
import { createComfyUploadAdapter } from './comfy-upload';
export const createRuntimeAdapters = (): Record<string, Adapter> => ({ ...createExternalAdapters(), 'reference.youtube': createReferenceAdapter('reference.youtube'), 'reference.sample': createReferenceAdapter('reference.sample'), 'comfy.router': createComfyRouterAdapter(), 'comfy.workflow': createComfyWorkflowAdapter(), 'comfy.upload': createComfyUploadAdapter(), 'asset.materialize': createMaterializeAdapter() });
