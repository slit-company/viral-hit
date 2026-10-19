import { createComfyRouterAdapter } from './comfy-router';
import { createComfyWorkflowAdapter } from './comfy-workflow';
import { createMaterializeAdapter } from './materialize';
import { createComfyUploadAdapter } from './comfy-upload';
export const createRuntimeAdapters = () => ({ 'comfy.router': createComfyRouterAdapter(), 'comfy.workflow': createComfyWorkflowAdapter(), 'comfy.upload': createComfyUploadAdapter(), 'asset.materialize': createMaterializeAdapter() });
