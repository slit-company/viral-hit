import { createComfyRouterAdapter } from './comfy-router';
import { createComfyWorkflowAdapter } from './comfy-workflow';
import { createMaterializeAdapter } from './materialize';
export const createRuntimeAdapters = () => ({ 'comfy.router': createComfyRouterAdapter(), 'comfy.workflow': createComfyWorkflowAdapter(), 'asset.materialize': createMaterializeAdapter() });
