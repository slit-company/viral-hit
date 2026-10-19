import { z } from 'zod';
import { readPointer } from './bindings';
import { workflowInput } from './comfy-workflow';
import { compileRecipe, recipeSchema, type Recipe } from './recipes';
import type { Json } from './durable';

const target = z.object({ nodeId: z.string().min(1).max(100), input: z.string().min(1).max(200) }).strict();
export const comfyRecipeDefinitionSchema = recipeSchema.omit({ nodes: true, parameters: true }).extend({
  output: workflowInput.shape.output.extend({ kind: z.enum(['image', 'video', 'audio']) }),
  parameters: z.array(z.object({
    parameter: recipeSchema.shape.parameters.element,
    targets: z.array(target).min(1).max(128),
  }).strict()).max(64),
});
const escape = (part: string) => part.replaceAll('~', '~0').replaceAll('/', '~1');
const pointer = (nodeId: string, input: string) => `/workflow/${escape(nodeId)}/inputs/${escape(input)}`;
function parseGraph(raw: unknown) {
  if (raw && typeof raw === 'object' && 'nodes' in raw && Array.isArray(raw.nodes)) throw new Error('Export the ComfyUI API-format graph (node IDs mapped to class_type and inputs), not the canvas layout JSON');
  return workflowInput.shape.workflow.parse(raw);
}

/** Inspection is local and data-only; output capabilities still come from the installed server. */
export function inspectComfyGraph(raw: unknown) {
  const graph = parseGraph(raw);
  return Object.entries(graph).map(([nodeId, node]) => ({
    nodeId, classType: node.class_type, title: node._meta?.title ?? node.class_type,
    inputs: Object.entries(node.inputs).map(([input, value]) => ({
      input, value, exposable: ['string', 'number', 'boolean'].includes(typeof value),
    })),
  }));
}

/** Package a native API graph as a portable data recipe, without installing or executing nodes. */
export function importComfyRecipe(rawGraph: unknown, rawDefinition: unknown): Recipe {
  const { output, parameters: exposures, ...metadata } = comfyRecipeDefinitionSchema.parse(rawDefinition);
  const { kind, ...selection } = output;
  const input = workflowInput.parse({ workflow: parseGraph(rawGraph), output: selection });
  const bindings: { parameter: string; target: string }[] = [];
  const uploads: Recipe['nodes'] = [];
  const outputBindings: NonNullable<Recipe['nodes'][number]['bindings']> = [];
  const parameters = exposures.map(({ parameter, targets }, index) => {
    const uploadId = `input-${index}`;
    const values = targets.map(target => {
      const path = pointer(target.nodeId, target.input);
      const value = readPointer(input as Json, path);
      const expectedType = parameter.type === 'enum' || parameter.type === 'asset' ? 'string' : parameter.type;
      if (typeof value !== expectedType) throw new Error(`Parameter ${parameter.id} must bind a ${expectedType} scalar input; node links and structured inputs cannot be replaced`);
      if (parameter.type === 'asset') outputBindings.push({ node: uploadId, pointer: '/image', target: path });
      else bindings.push({ parameter: parameter.id, target: path });
      return value;
    });
    if (parameter.type === 'asset') {
      uploads.push({ id: uploadId, operation: 'comfy.upload', version: '1', cache: false, input: { assetId: '' }, parameters: [{ parameter: parameter.id, target: '/assetId' }] });
      return parameter; // A ComfyUI filename is never a project asset ID or an inferred default.
    }
    return { ...parameter, default: parameter.default ?? values[0] };
  });
  if (uploads.length) { input.connection = null; outputBindings.push({ node: uploads[0].id, pointer: '/connection', target: '/connection' }); }
  const recipe = recipeSchema.parse({ ...metadata, parameters, nodes: [
    ...uploads,
    { id: 'workflow', operation: 'comfy.workflow', version: '1', cache: false, input, parameters: bindings, ...(uploads.length ? { dependsOn: uploads.map(node => node.id), bindings: outputBindings } : {}) },
    { id: 'media', operation: 'asset.materialize', version: '1', cache: false,
      input: { receipt: null, kind, label: metadata.title }, dependsOn: ['workflow'],
      bindings: [{ node: 'workflow', pointer: '/binaryReceipt', target: '/receipt' }] },
  ] });
  // Check defaults, duplicates, target overlap and execution graph before writing a discoverable manifest.
  const validationValues = Object.fromEntries(parameters.filter(p => p.type === 'asset' && p.default === undefined).map(p => [p.id, 'offline-input']));
  compileRecipe(recipe, validationValues, 'offline-import-validation', new Set(['comfy.workflow', 'comfy.upload', 'asset.materialize']));
  if (Buffer.byteLength(JSON.stringify(recipe, null, 2) + '\n') > 128_000) throw new Error('Imported recipe exceeds the registry limit of 128 KB');
  return recipe;
}
