import { useCallback, useEffect, useRef, useState } from 'react';
import { apiJsonGet, apiJsonPost } from '@/lib/api-client';
import {
  MAX_CATALOG_BYTES,
  type CatalogReview,
  type SavedCatalog,
} from '@/core/community/contract';

export function useCommunity() {
  const [catalogs, setCatalogs] = useState<SavedCatalog[]>(),
    [review, setReview] = useState<CatalogReview>();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [activity, setActivity] = useState(''),
    [cancelable, setCancelable] = useState(false);
  const active = useRef<AbortController | null>(null);
  const load = useCallback(
    async () =>
      setCatalogs(
        (await apiJsonGet<{ catalogs: SavedCatalog[] }>('/api/app/community'))
          .catalogs,
      ),
    [],
  );
  useEffect(() => {
    void load().catch(() =>
      setError('Catalogs could not load. Reload to retry.'),
    );
    return () => active.current?.abort();
  }, [load]);
  async function work<T>(
    task: (signal: AbortSignal) => Promise<T>,
    apply: (result: T) => void,
    label = 'Reading catalog…',
    canCancel = true,
  ) {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setActivity(label);
    setCancelable(canCancel);
    setError('');
    setNotice('');
    try {
      const result = await task(controller.signal);
      if (!controller.signal.aborted) apply(result);
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(
          cause instanceof Error ? cause.message : 'Catalog request failed',
        );
    } finally {
      if (active.current === controller) {
        active.current = null;
        setBusy(false);
      }
    }
  }
  function fetchLink(url: string) {
    setReview(undefined);
    return work(
      (signal) =>
        apiJsonPost<CatalogReview>(
          '/api/app/community',
          { action: 'fetch', url: url.trim() },
          { signal },
        ),
      setReview,
    );
  }
  function importFile(file?: File) {
    if (!file) return;
    setReview(undefined);
    return work(async (signal) => {
      if (file.size > MAX_CATALOG_BYTES)
        throw new Error('Catalogs must be 512 KB or smaller');
      let catalog: unknown;
      try {
        catalog = JSON.parse(await file.text());
      } catch {
        throw new Error('This file is not valid JSON');
      }
      return apiJsonPost<CatalogReview>(
        '/api/app/community',
        { action: 'inspect', catalog },
        { signal },
      );
    }, setReview);
  }
  function save() {
    if (!review) return;
    return work(
      async (signal) => {
        await apiJsonPost(
          '/api/app/community',
          {
            action: 'save',
            catalog: review.catalog,
            source: review.source,
            expectedDigest: review.digest,
            expectedPreviousDigest: review.previousDigest,
          },
          { signal },
        );
        await load();
        return review.catalog.title;
      },
      (title) => {
        setReview(undefined);
        setNotice(title + ' is ready to browse. No entries were installed.');
      },
      'Saving catalog…',
      false,
    );
  }
  function remove(item: SavedCatalog) {
    return work(
      async (signal) => {
        await apiJsonPost(
          '/api/app/community',
          {
            action: 'remove',
            id: item.catalog.id,
            expectedDigest: item.digest,
          },
          { signal },
        );
        await load();
      },
      () =>
        setNotice(
          item.catalog.title +
            ' was removed from discovery. Installed contents are kept.',
        ),
      'Removing catalog…',
      false,
    );
  }
  function download(item: SavedCatalog) {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(item.catalog, null, 2) + '\n'], {
        type: 'application/json',
      }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = item.catalog.id + '.viralhit-catalog.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function close() {
    active.current?.abort();
    active.current = null;
    setBusy(false);
    setReview(undefined);
    setError('');
  }
  return {
    catalogs,
    review,
    busy,
    activity,
    canCancel: busy && cancelable,
    error,
    notice,
    fetchLink,
    importFile,
    save,
    remove,
    download,
    close,
  };
}
export type CommunityLibrary = ReturnType<typeof useCommunity>;
