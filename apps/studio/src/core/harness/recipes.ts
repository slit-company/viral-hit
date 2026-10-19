import { z } from 'zod';
import { compilePlan, type Json, type Plan } from './durable';
import { pointerParts, setPointer } from './bindings';

const identifier = z.string().regex(/^[a-z][a-z0-9-]{0,79}$/).refine(value => !['constructor', 'prototype', '__proto__'].includes(value));
const version = z.string().regex(/^\d+\.\d+\.\d+$/);
const parameterBase = { id: identifier, label: z.string().min(1).max(120), description: z.string().max(1000).optional() };
const parameter = z.discriminatedUnion('type', [
  z.object({ ...parameterBase, type: z.literal('string'), multiline: z.boolean().optional(), default: z.string().max(16000).optional(), minLength: z.number().int().min(0).max(16000).optional(), maxLength: z.number().int().min(1).max(16000).optional() }).strict(),
  z.object({ ...parameterBase, type: z.literal('number'), default: z.number().finite().optional(), min: z.number().finite().optional(), max: z.number().finite().optional(), integer: z.boolean().optional() }).strict(),
  z.object({ ...parameterBase, type: z.literal('boolean'), default: z.boolean().optional() }).strict(),
  z.object({ ...parameterBase, type: z.literal('enum'), options: z.array(z.string().min(1).max(200)).min(1).max(100), default: z.string().optional() }).strict(),
]);
export const recipeSchema = z.object({
  schemaVersion: z.literal(1), id: identifier, version,
  title: z.string().min(1).max(120), description: z.string().min(1).max(2000),
  license: z.string().min(1).max(100), author: z.string().min(1).max(120),
  category: identifier, tags: z.array(identifier).max(16).default([]),
  parameters: z.array(parameter).max(64),
  nodes: z.array(z.object({
    id: identifier, operation: z.string().regex(/^[a-z][a-z0-9_.-]{0,127}$/), version: z.string().min(1).max(80), input: z.json(),
    dependsOn: z.array(identifier).max(256).optional(), cache: z.boolean().optional(),
    parameters: z.array(z.object({ parameter: identifier, target: z.string().max(1024) }).strict()).max(128).optional(),
    bindings: z.array(z.object({ target: z.string().max(1024), node: identifier, pointer: z.string().max(1024) }).strict()).max(128).optional(),
  }).strict()).min(1).max(256),
}).strict();
export type Recipe = z.infer<typeof recipeSchema>;

function validateValue(definition: Recipe['parameters'][number], value: unknown): Json {
  const fail = () => { throw new Error(`Invalid recipe parameter: ${definition.id}`); };
  if (value === undefined) fail();
  switch (definition.type) {
    case 'string':
      if (typeof value !== 'string' || value.length < (definition.minLength ?? 1) || value.length > (definition.maxLength ?? 16000)) fail();
      break;
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value) || (definition.min !== undefined && value < definition.min) || (definition.max !== undefined && value > definition.max) || (definition.integer && !Number.isInteger(value))) fail();
      break;
    case 'boolean': if (typeof value !== 'boolean') fail(); break;
    case 'enum': if (typeof value !== 'string' || !definition.options.includes(value)) fail(); break;
  }
  return value as Json;
}

/** Data-only compilation: recipes cannot load modules, run scripts or read environment variables. */
export function compileRecipe(raw: unknown, supplied: Record<string, unknown>, projectId: string, availableOperations?: ReadonlySet<string>): Plan {
  const recipe = recipeSchema.parse(raw);
  const parameters = new Map(recipe.parameters.map(p => [p.id, p]));
  if (parameters.size !== recipe.parameters.length) throw new Error('Duplicate recipe parameter');
  if (Object.keys(supplied).some(key => !parameters.has(key))) throw new Error('Unknown recipe parameter');
  const values = new Map(recipe.parameters.map(p => [p.id, validateValue(p, Object.hasOwn(supplied, p.id) ? supplied[p.id] : p.default)]));
  const nodes = recipe.nodes.map(node => {
    if (availableOperations && !availableOperations.has(node.operation)) throw new Error(`Required operation is unavailable: ${node.operation}`);
    const input = structuredClone(node.input) as Json;
    const targets: string[][] = [];
    for (const binding of node.parameters ?? []) {
      if (!values.has(binding.parameter)) throw new Error('Unknown parameter binding');
      const target = pointerParts(binding.target);
      const occupied = [...targets, ...(node.bindings ?? []).map(b => pointerParts(b.target))];
      if (occupied.some(other => other.slice(0, Math.min(other.length, target.length)).every((part, i) => part === target[i]))) throw new Error('Recipe input bindings overlap');
      targets.push(target); setPointer(input, binding.target, values.get(binding.parameter)!);
    }
    return { id: node.id, operation: node.operation, version: `${node.version}@${recipe.id}:${recipe.version}`, input, dependsOn: node.dependsOn, cache: node.cache, bindings: node.bindings };
  });
  // Omit optional undefined fields to preserve canonical JSON fingerprints.
  const plan = JSON.parse(JSON.stringify({ projectId, nodes })) as Plan;
  compilePlan(plan);
  return plan;
}
