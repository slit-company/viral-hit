import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { z } from 'zod';
import { canonicalJson } from '@/lib/canonical-json';
import { downloadMedia, mediaUrl } from '@/core/harness/download-media';
import { packSourceUrl } from '@/core/harness/recipe-pack-source';
import {
  MAX_CATALOG_BYTES,
  catalogUrlSchema,
  communityCatalogSchema,
  communityRequest,
  type CatalogReview,
} from './contract';
import {
  CatalogConflictError,
  readCatalogs,
  removeCatalog,
  saveCatalog,
} from './storage.server';

export function validateCatalog(raw: unknown) {
  const text = JSON.stringify(raw);
  if (!text || Buffer.byteLength(text) > MAX_CATALOG_BYTES)
    throw new Error('Catalogs must be 512 KB or smaller');
  const catalog = communityCatalogSchema.parse(raw),
    ids = new Set<string>();
  for (const entry of catalog.entries) {
    if (ids.has(entry.id))
      throw new Error('Duplicate catalog entry ID: ' + entry.id);
    ids.add(entry.id);
    mediaUrl(entry.url);
  }
  if (catalog.homepage) mediaUrl(catalog.homepage);
  return catalog;
}
export function inspectCatalog(
  raw: unknown,
  rawSource?: string,
): CatalogReview {
  const catalog = validateCatalog(raw),
    source = rawSource
      ? packSourceUrl(catalogUrlSchema.parse(rawSource))
      : undefined;
  const digest = createHash('sha256')
    .update(canonicalJson({ catalog, source: source ?? null }))
    .digest('hex');
  const previous = readCatalogs().find(
    (item) => item.catalog.id === catalog.id,
  );
  const before = new Map(
      previous?.catalog.entries.map((entry) => [entry.id, entry]) ?? [],
    ),
    after = new Map(catalog.entries.map((entry) => [entry.id, entry]));
  return {
    catalog,
    ...(source ? { source } : {}),
    digest,
    previousDigest: previous?.digest ?? null,
    changes: {
      details: previous
        ? [
            ...(['title', 'description', 'author', 'homepage'] as const).filter(
              (field) => previous.catalog[field] !== catalog[field],
            ),
            ...(previous.source !== source ? ['source'] : []),
          ]
        : [],
      added: catalog.entries
        .filter((entry) => !before.has(entry.id))
        .map((entry) => entry.id),
      removed: [...before.keys()].filter((id) => !after.has(id)),
      changed: catalog.entries
        .filter(
          (entry) =>
            before.has(entry.id) &&
            canonicalJson(before.get(entry.id)!) !== canonicalJson(entry),
        )
        .map((entry) => entry.id),
    },
  };
}
export async function fetchCatalog(
  raw: string,
  signal = AbortSignal.timeout(20_000),
  download = downloadMedia,
) {
  signal = AbortSignal.any([signal, AbortSignal.timeout(20_000)]);
  const source = packSourceUrl(catalogUrlSchema.parse(raw));
  const directory = await mkdtemp(join(tmpdir(), 'vh-community-'));
  try {
    const path = join(directory, 'catalog.json');
    await download(source, path, signal, MAX_CATALOG_BYTES);
    const text = await readFile(path, 'utf8');
    if (Buffer.byteLength(text) > MAX_CATALOG_BYTES)
      throw new Error('Catalogs must be 512 KB or smaller');
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error('This link did not return a catalog JSON file');
    }
    return inspectCatalog(parsed, source);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
/** Catalog operations change discovery metadata only; entry files have their own review/install operations. */
export async function changeCommunity(
  raw: z.infer<typeof communityRequest>,
  signal?: AbortSignal,
) {
  const request = communityRequest.parse(raw);
  switch (request.action) {
    case 'list':
      return { catalogs: readCatalogs() };
    case 'get': {
      const found = readCatalogs().find(
        (item) => item.catalog.id === request.id,
      );
      if (!found) throw new Error('Catalog not found');
      return found;
    }
    case 'inspect':
      return inspectCatalog(request.catalog, request.source);
    case 'fetch':
      return fetchCatalog(request.url, signal);
    case 'save': {
      const review = inspectCatalog(request.catalog, request.source);
      if (review.digest !== request.expectedDigest)
        throw new CatalogConflictError(
          'Catalog contents changed after review. Review them again.',
        );
      return {
        ...saveCatalog(
          {
            catalog: review.catalog,
            source: review.source,
            digest: review.digest,
            updatedAt: new Date().toISOString(),
          },
          request.expectedPreviousDigest,
        ),
        id: review.catalog.id,
      };
    }
    case 'remove':
      return removeCatalog(request.id, request.expectedDigest);
  }
}
