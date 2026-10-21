import { z } from 'zod';
import { catalogUrlSchema, catalogDigestSchema } from '../community/contract';

export { MAX_RUNTIME_PACKAGE_BYTES } from './limits';
export const runtimePackageId = z.string().regex(/^[a-z][a-z0-9-]{0,39}$/);
export const runtimeKind = z.enum(['adapter', 'provider', 'publishing']);
export const runtimeEntrySchema = z.object({
  kind: runtimeKind, manifest: z.record(z.string(), z.json()), source: z.string().min(1).max(5 * 1024 * 1024),
}).strict();
export const runtimePackageSchema = z.object({
  schemaVersion: z.literal(1), kind: z.literal('viral-hit-runtime-package'), id: runtimePackageId,
  version: z.string().regex(/^\d+\.\d+\.\d+$/).max(24), title: z.string().trim().min(1).max(100),
  description: z.string().trim().min(1).max(1000), author: z.string().trim().min(1).max(200), license: z.string().trim().min(1).max(100),
  scope: z.enum(['general', 'specialized']), requirements: z.string().max(2000).optional(),
  entries: z.array(runtimeEntrySchema).min(1).max(16),
}).strict();
export type RuntimePackage = z.infer<typeof runtimePackageSchema>;
export type RuntimeEntry = RuntimePackage['entries'][number];
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const runtimePackageLocalRequest = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list') }).strict(),
  z.object({ action: z.literal('inspect'), package: runtimePackageSchema }).strict(),
  z.object({ action: z.literal('apply'), package: runtimePackageSchema, expectedDigest: digest, expectedStateDigest: digest, trustCode: z.literal(true) }).strict(),
  z.object({ action: z.literal('review-remove'), id: runtimePackageId }).strict(),
  z.object({ action: z.literal('remove'), id: runtimePackageId, expectedStateDigest: digest }).strict(),
  z.object({ action: z.literal('history'), id: runtimePackageId }).strict(),
  z.object({ action: z.literal('export'), id: runtimePackageId, digest: digest.optional() }).strict(),
]);
export const runtimePackageFetchRequest = z.object({
  action: z.literal('fetch'), url: catalogUrlSchema, expectedSha256: catalogDigestSchema.optional(),
}).strict();
export const runtimePackageRequest = z.discriminatedUnion('action', [
  ...runtimePackageLocalRequest.options, runtimePackageFetchRequest,
]);
export type RuntimePackageDownload = { source: string; sha256: string; catalogPinned: boolean };
export type RuntimePackageLocalRequest = z.infer<typeof runtimePackageLocalRequest>;
export type RuntimePackageRequest = z.infer<typeof runtimePackageRequest>;
export type RuntimePackageSummary = Pick<RuntimePackage, 'id' | 'version' | 'title' | 'description' | 'author' | 'license' | 'scope'> & { digest: string; entries: { kind: RuntimeEntry['kind']; id: string; label: string }[] };

export type RuntimePackageCatalog = { installed: RuntimePackageSummary[]; removed: RuntimePackageSummary[]; loaded: RuntimePackageSummary[]; restartRequired: boolean; restart: string };
export type RuntimePackageHistory = { id: string; currentDigest: string | null; releases: RuntimePackageSummary[] };
