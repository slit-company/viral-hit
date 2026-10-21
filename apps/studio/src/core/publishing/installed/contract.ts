import { z } from 'zod';
import type { JsonValue } from '@/lib/canonical-json';
import type { PublicationAsset } from '../contracts';

export const installedConnectorId = z.string().regex(/^ext\.[a-z][a-z0-9-]{0,59}$/);
const identifier = z.string().regex(/^[a-zA-Z0-9_.-]{1,128}$/);
export const connectorManifestSchema = z.object({
  schemaVersion: z.literal(1), kind: z.literal('viral-hit-publishing-connector'), id: installedConnectorId,
  version: z.string().regex(/^\d+\.\d+\.\d+$/).max(14), label: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(500), scope: z.enum(['general', 'specialized']),
  author: z.string().trim().min(1).max(120), license: z.string().trim().min(1).max(80),
  entry: z.string().regex(/^[A-Za-z0-9_-]+\.mjs$/).default('connector.mjs'),
  mediaTypes: z.array(z.enum(['image/png', 'image/jpeg', 'image/webp', 'video/mp4', 'video/webm', 'audio/wav', 'audio/mpeg', 'audio/mp4', 'audio/ogg'])).min(1).max(9),
  maxAssets: z.number().int().min(1).max(20).default(1),
  environment: z.array(z.string().regex(/^[A-Z][A-Z0-9_]{0,100}$/)).max(24).default([]),
  destinations: z.array(z.object({ id: identifier, label: z.string().trim().min(1).max(100), destinationId: identifier,
    configuration: z.record(z.string(), z.json()).default({}),
  }).strict()).min(1).max(30),
  metadataSchema: z.record(z.string(), z.json()),
}).strict().superRefine((manifest, ctx) => {
  if (new Set(manifest.destinations.map(item => item.id)).size !== manifest.destinations.length) ctx.addIssue({ code: 'custom', message: 'Destination IDs must be unique' });
  if (manifest.metadataSchema.type !== 'object' || manifest.metadataSchema.$async) ctx.addIssue({ code: 'custom', message: 'Metadata must use a synchronous object JSON Schema' });
});
export type ConnectorManifest = z.infer<typeof connectorManifestSchema>;
export type InstalledConnectorDescriptor = Pick<ConnectorManifest, 'id' | 'version' | 'label' | 'description' | 'scope' | 'author' | 'license' | 'mediaTypes' | 'maxAssets' | 'metadataSchema'> & {
  runtimeVersion: string; configured: boolean; missingEnvironment: string[];
  destinations: Pick<ConnectorManifest['destinations'][number], 'id' | 'label' | 'destinationId'>[];
};
export type InstalledConnectorCatalog = { connectors: InstalledConnectorDescriptor[]; problems: { location: string; message: string }[] };
export const publicConnectorDeliverySchema = z.object({ id: z.string().min(1).max(200), label: z.string().min(1).max(120).optional(), url: z.string().url().max(2000).refine(value => { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; }, 'Use a public HTTPS post link').optional() }).strict();
export type ExternalPublicationReview = { label: string; title: string; available: boolean; delivery: z.infer<typeof publicConnectorDeliverySchema> | null; assets: PublicationAsset[]; metadata: JsonValue };
