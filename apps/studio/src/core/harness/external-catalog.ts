import { pointerParts } from './bindings';
import { executionPolicy } from './execution-policy';
import { MAX_ADAPTER_INPUT_BYTES, projectMediaPin } from './project-media-input-schema';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import Ajv from 'ajv';
import { z } from 'zod';
import { fingerprint, RejectedSubmission, type Json, type Plan } from './durable';

export const externalOperation = z.string().regex(/^ext\.[a-z][a-z0-9_.-]{0,119}$/);
export const externalDescriptor = z.object({
  schemaVersion: z.literal(1), operation: externalOperation,
  version: z.string().regex(/^[a-zA-Z0-9._-]{1,80}$/), label: z.string().min(1).max(100),
  author: z.string().min(1).max(200), license: z.string().min(1).max(100),
  entry: z.string().regex(/^[a-zA-Z0-9_-][a-zA-Z0-9_.-]*\.mjs$/), sha256: z.string().regex(/^[a-f0-9]{64}$/),
  recovery: z.enum(['manual', 'replay', 'reconcile']), generation: z.boolean(),
  execution: executionPolicy.optional(),
  configuration: z.array(z.object({ name: z.string().regex(/^[A-Z][A-Z0-9_]{0,100}$/), required: z.boolean() }).strict()).max(32).default([]),
  assetInputs: z.array(z.object({ id: z.string().regex(/^[a-z][a-z0-9-]{0,79}$/).refine(id => !['constructor', 'prototype'].includes(id)), pointer: z.string().min(1).max(1024), kind: z.enum(['image', 'video', 'audio']), maxBytes: z.number().int().positive().max(MAX_ADAPTER_INPUT_BYTES).default(32 * 1024 * 1024), optional: z.boolean().optional() }).strict()).min(1).max(16).optional(),
  inputSchema: z.record(z.string(), z.json()),
}).strict();
export type ExternalDescriptor = z.infer<typeof externalDescriptor>;
function boundedRead(file: string, max: number) {
  const stat = statSync(file);
  if (!stat.isFile() || stat.size < 1 || stat.size > max) throw new Error('Adapter file is not a bounded regular file');
  const bytes = readFileSync(file);
  if (bytes.length > max) throw new Error('Adapter file exceeds limit');
  return bytes;
}
export function readExternalCatalog(directory: string | undefined) {
  if (!directory) return [];
  if (!isAbsolute(directory)) throw new Error('VIRAL_HIT_ADAPTERS_DIR must be an absolute directory');
  const files = readdirSync(directory).filter(name => name.endsWith('.json')).sort();
  if (files.length > 32) throw new Error('At most 32 external adapters are supported');
  const operations = new Set<string>(); let totalBytes = 0;
  return files.map(file => {
    const descriptor = externalDescriptor.parse(JSON.parse(boundedRead(join(directory, file), 64_000).toString('utf8')));
    if (operations.has(descriptor.operation)) throw new Error(`Duplicate adapter operation: ${descriptor.operation}`);
    operations.add(descriptor.operation);
    if (new Set(descriptor.configuration.map(item => item.name)).size !== descriptor.configuration.length) throw new Error('Duplicate adapter configuration variable');
    const inputs = descriptor.assetInputs ?? [];
    if (new Set(inputs.map(input => input.id)).size !== inputs.length) throw new Error('Duplicate adapter asset input');
    const pointers = inputs.map(input => pointerParts(input.pointer));
    if (pointers.some((pointer, index) => !pointer.length || pointers.slice(0, index).some(other => other.slice(0, Math.min(other.length, pointer.length)).every((part, i) => part === pointer[i])))) throw new Error('Adapter asset input pointers overlap');
    if (inputs.reduce((sum, input) => sum + input.maxBytes, 0) > MAX_ADAPTER_INPUT_BYTES) throw new Error('Adapter asset inputs exceed 512 MiB aggregate');
    const bytes = boundedRead(join(directory, descriptor.entry), 2_000_000);
    totalBytes += bytes.length;
    if (totalBytes > 8_000_000) throw new Error('Adapter modules exceed 8 MB aggregate');
    if (createHash('sha256').update(bytes).digest('hex') !== descriptor.sha256) throw new Error(`Adapter SHA-256 mismatch: ${descriptor.operation}`);
    if (descriptor.inputSchema.$async) throw new Error('Adapter input schema must be synchronous');
    const validate = new Ajv({ strict: true, allErrors: false, ownProperties: true }).compile(descriptor.inputSchema);
    // No module import occurs here. UI/HTTP/MCP only inspect data and pinned source bytes.
    return { descriptor, source: bytes.toString('utf8'), digest: fingerprint(descriptor as unknown as Json), validate };
  });
}
export type ExternalEntry = ReturnType<typeof readExternalCatalog>[number];
const catalogs = new Map<string, ReturnType<typeof readExternalCatalog>>();
/** Process-lifetime snapshot. Restart app, MCP and worker together after installation/update. */
export function externalCatalog() {
  const directory = process.env.VIRAL_HIT_ADAPTERS_DIR ?? '';
  if (!catalogs.has(directory)) catalogs.set(directory, readExternalCatalog(directory));
  return catalogs.get(directory)!;
}
export function externalConfigured(entry: ExternalEntry) {
  return entry.descriptor.configuration.every(item => !item.required || Boolean(process.env[item.name]?.trim()));
}
export function externalConfigurationDigest(entry: ExternalEntry) {
  return fingerprint(Object.fromEntries(entry.descriptor.configuration.map(item => [item.name, process.env[item.name] ?? null])));
}
export function validateExternalInput(entry: ExternalEntry, value: Json) {
  if (!entry.validate(value)) throw new RejectedSubmission(`Invalid ${entry.descriptor.operation} input: ${entry.validate.errors?.[0]?.instancePath || '/'} ${entry.validate.errors?.[0]?.message ?? 'schema mismatch'}`);
}
export const externalEnvelope = z.object({
  adapter: z.object({ digest: z.string().regex(/^[a-f0-9]{64}$/), configuration: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  payload: z.json(),
  assetPins: z.record(z.string(), z.union([projectMediaPin, z.null(), z.object({ projectId: z.null(), assetId: z.null(), kind: z.null(), sha256: z.null(), sizeBytes: z.null() }).strict()])).optional(),
}).strict();
export function pinExternalAdapters(plan: Plan, entries = externalCatalog()): Plan {
  return { ...plan, nodes: plan.nodes.map(node => {
    if (!node.operation.startsWith('ext.')) return node;
    const entry = entries.find(item => item.descriptor.operation === node.operation);
    if (!entry || !externalConfigured(entry)) throw new RejectedSubmission(`External adapter unavailable: ${node.operation}`);
    if (node.version.split('@')[0] !== entry.descriptor.version) throw new RejectedSubmission(`External adapter version mismatch: ${node.operation}`);
    if (!node.bindings?.length) validateExternalInput(entry, node.input);
    return { ...node, input: { adapter: { digest: entry.digest, configuration: externalConfigurationDigest(entry) }, payload: node.input },
      bindings: node.bindings?.map(binding => ({ ...binding, target: `/payload${binding.target}` })) };
  }) };
}
