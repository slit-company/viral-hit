import { z } from 'zod';
import { PublicationStartError, PublicationPublishError, type PublicationConnector, type PublicationSpec } from '../contracts';
import type { JsonValue } from '@/lib/canonical-json';
import { validateInstalledPublication, type InstalledConnector } from './catalog.server';
import { measurementIssue, measurementResultSchema, MeasurementUnavailable } from '../../measurement/contract';

const json = z.json().refine(value => value !== null && Buffer.byteLength(JSON.stringify(value)) <= 64_000, 'Connector checkpoint/receipt must be non-null and at most 64 KB');
const retry = z.number().int().min(0).max(86_400_000).optional();
const notWritten = z.object({ outcome: z.enum(['unavailable', 'rejected']), retryAfterMs: retry }).strict();
const startResult = z.union([z.object({ checkpoint: json }).strict(), z.object({ notStarted: notWritten }).strict()]);
const transferResult = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('progress'), checkpoint: json, retryAfterMs: retry }).strict(),
  z.object({ kind: z.literal('accepted'), receipt: json }).strict(),
  z.object({ kind: z.literal('uncertain'), issue: z.enum(['session-expired', 'upload-unknown']) }).strict(),
]);
const remoteResult = z.object({ state: z.enum(['processing', 'staged', 'ready', 'scheduled', 'published', 'failed']), receipt: json, retryAfterMs: retry }).strict();
const publishResult = z.union([remoteResult, z.object({ notPublished: notWritten }).strict()]);
const measureResult = z.union([measurementResultSchema, z.object({ unavailable: z.object({ issue: measurementIssue }).strict() }).strict()]);
type Method = (request: Record<string, unknown>) => Promise<unknown>;
type Module = { start: Method; transfer: Method; reconcile: Method; inspect: Method; publish?: Method; measure?: Method; notBefore?: (request: Record<string, unknown>) => number | null };
const nativeImport = new Function('url', 'return import(url)') as (url: string) => Promise<Module>;
const modules = new Map<string, Promise<Module>>();

async function load(entry: InstalledConnector) {
  let pending = modules.get(entry.runtimeVersion);
  if (!pending) {
    if (modules.size >= 32) modules.delete(modules.keys().next().value!);
    pending = nativeImport('data:text/javascript;base64,' + Buffer.from(entry.source).toString('base64')).then(module => {
      for (const method of ['start', 'transfer', 'reconcile', 'inspect'] as const) if (typeof module[method] !== 'function') throw new Error('Connector must export ' + method);
      if (module.publish !== undefined && typeof module.publish !== 'function') throw new Error('Invalid publish function');
      if (module.measure !== undefined && typeof module.measure !== 'function') throw new Error('Invalid measure function');
      if (module.notBefore !== undefined && typeof module.notBefore !== 'function') throw new Error('Invalid scheduling function');
      return module;
    });
    modules.set(entry.runtimeVersion, pending);
  }
  return pending;
}

/** Executable code is loaded only inside the publication worker, after the normal approval checks. */
export async function openInstalledPublicationConnector(spec: PublicationSpec): Promise<PublicationConnector> {
  const entry = validateInstalledPublication(spec);
  if (!entry.descriptor.configured) throw new Error('Connector environment is incomplete');
  const module = await load(entry), destination = entry.manifest.destinations.find(item => item.id === spec.accountId)!;
  const context = (current: PublicationSpec, signal?: AbortSignal) => {
    const now = validateInstalledPublication(current);
    if (now.runtimeVersion !== entry.runtimeVersion) throw new Error('Connector identity changed before operation');
    signal?.throwIfAborted();
    return { spec: structuredClone(current), destination: structuredClone(destination), environment: { ...entry.environment }, signal };
  };
  return {
    id: entry.manifest.id, version: entry.runtimeVersion,
    ...(module.notBefore ? { notBefore: (current: PublicationSpec, phase: 'start' | 'publish') => z.number().int().nonnegative().nullable().parse(module.notBefore!({ ...context(current), phase })) } : {}),
    async start(current, signal) {
      const result = startResult.parse(await module.start(context(current, signal)));
      if ('notStarted' in result) throw new PublicationStartError(result.notStarted.outcome, result.notStarted.retryAfterMs);
      return result.checkpoint;
    },
    async transfer(current, checkpoint, read, signal) {
      return transferResult.parse(await module.transfer({ ...context(current, signal), checkpoint: structuredClone(checkpoint), read }));
    },
    async reconcile(current, checkpoint, signal) {
      return transferResult.parse(await module.reconcile({ ...context(current, signal), checkpoint: structuredClone(checkpoint) }));
    },
    async inspect(current, receipt, signal) {
      return remoteResult.parse(await module.inspect({ ...context(current, signal), receipt: structuredClone(receipt) }));
    },
    ...(module.publish ? { async publish(current: PublicationSpec, receipt: JsonValue, signal: AbortSignal) {
      const result = publishResult.parse(await module.publish!({ ...context(current, signal), receipt: structuredClone(receipt) }));
      if ('notPublished' in result) throw new PublicationPublishError(result.notPublished.outcome, result.notPublished.retryAfterMs);
      return result;
    } } : {}),
    // Only connectors that declare measurement in connector.json are asked for readings.
    ...(module.measure && entry.manifest.measurement ? { async measure(current: PublicationSpec, receipt: JsonValue, signal: AbortSignal) {
      const result = measureResult.parse(await module.measure!({ ...context(current, signal), receipt: structuredClone(receipt), metrics: [...entry.manifest.measurement!.metrics] }));
      if ('unavailable' in result) throw new MeasurementUnavailable(result.unavailable.issue);
      return result;
    } } : {}),
  };
}
