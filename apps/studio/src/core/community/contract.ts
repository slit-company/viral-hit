import { z } from 'zod';

export const MAX_CATALOG_BYTES = 512_000;
export const catalogDigestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const id = z.string().regex(/^[a-z][a-z0-9-]{0,79}$/);
export const catalogUrlSchema = z
  .string()
  .url()
  .max(2000)
  .refine((raw) => {
    const url = new URL(raw);
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      (!url.port || url.port === '443')
    );
  }, 'Use a stable public HTTPS file URL without credentials, query strings, fragments or a custom port');
export const catalogEntrySchema = z
  .object({
    id,
    kind: z.enum(['skill', 'recipe-pack', 'creative-pack']),
    title: z.string().trim().min(1).max(120),
    summary: z.string().trim().min(1).max(500),
    scope: z.enum(['general', 'specialized']),
    version: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/),
    tags: z.array(z.string().trim().min(1).max(40)).max(8).default([]),
    url: catalogUrlSchema,
    sha256: catalogDigestSchema,
  })
  .strict();
export const communityCatalogSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal('viral-hit-catalog'),
    id,
    title: z.string().trim().min(1).max(120),
    description: z.string().trim().min(1).max(600),
    author: z.string().trim().min(1).max(120),
    homepage: catalogUrlSchema.optional(),
    entries: z.array(catalogEntrySchema).max(200),
  })
  .strict();
export type CommunityCatalog = z.infer<typeof communityCatalogSchema>;
export type CatalogEntry = z.infer<typeof catalogEntrySchema>;
export type SavedCatalog = {
  catalog: CommunityCatalog;
  source?: string;
  digest: string;
  updatedAt: string;
};
export type CatalogReview = Omit<SavedCatalog, 'updatedAt'> & {
  previousDigest: string | null;
  changes: {
    added: string[];
    removed: string[];
    changed: string[];
    details: string[];
  };
};
export const communityRequest = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list') }).strict(),
  z.object({ action: z.literal('get'), id }).strict(),
  z
    .object({
      action: z.literal('inspect'),
      catalog: z.unknown(),
      source: catalogUrlSchema.optional(),
    })
    .strict(),
  z.object({ action: z.literal('fetch'), url: catalogUrlSchema }).strict(),
  z
    .object({
      action: z.literal('save'),
      catalog: z.unknown(),
      source: catalogUrlSchema.optional(),
      expectedDigest: catalogDigestSchema,
      expectedPreviousDigest: catalogDigestSchema.nullable(),
    })
    .strict(),
  z
    .object({
      action: z.literal('remove'),
      id,
      expectedDigest: catalogDigestSchema,
    })
    .strict(),
]);

/** A handoff only prefills a library's explicit Review link action; route loading fetches nothing. */
export const catalogHandoffSchema = z.object({
  source: catalogUrlSchema.optional(),
  sha256: catalogDigestSchema.optional(),
});
export type CatalogHandoff = z.infer<typeof catalogHandoffSchema>;
export function catalogEntryHref(entry: CatalogEntry) {
  const path =
    entry.kind === 'skill'
      ? '/skills'
      : entry.kind === 'creative-pack'
        ? '/packs'
        : '/recipe-packs';
  return (
    path +
    '?' +
    new URLSearchParams({ source: entry.url, sha256: entry.sha256 })
  );
}
