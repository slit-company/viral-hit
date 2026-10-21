import { useEffect, useRef, useState } from 'react';
import { apiJsonPost } from '@/lib/api-client';
import type { Recipe } from '@/core/harness/recipes';
import type {
  RecipeInspection,
  RecipeRemovalReview,
} from '@/core/harness/recipe-library-contract';

export function downloadRecipe(recipe: Recipe) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(recipe, null, 2) + '\n'], {
      type: 'application/json',
    }),
  );
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${recipe.id}-${recipe.version}.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function useRecipeLibrary(
  selected: Recipe | undefined,
  onInstalled: (recipe: Recipe) => Promise<void>,
  onRemoved: (recipe: Recipe) => Promise<void>,
) {
  const [text, setText] = useState(''),
    [inspection, setInspection] = useState<RecipeInspection>();
  const [removal, setRemoval] = useState<RecipeRemovalReview>();
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [confirmed, setConfirmed] = useState(false);
  const epoch = useRef(0);
  useEffect(
    () => () => {
      epoch.current++;
    },
    [],
  );
  function edit(value: string) {
    epoch.current++;
    setText(value);
    setInspection(undefined);
    setRemoval(undefined);
    setConfirmed(false);
    setError('');
  }
  async function work<T>(
    task: () => Promise<T>,
    apply: (result: T) => void | Promise<void>,
  ) {
    const current = ++epoch.current;
    setBusy(true);
    setError('');
    try {
      const result = await task();
      if (current === epoch.current) await apply(result);
    } catch (cause) {
      if (current === epoch.current)
        setError(
          cause instanceof Error ? cause.message : 'Recipe request failed',
        );
    } finally {
      if (current === epoch.current) setBusy(false);
    }
  }
  function loadFile(file?: File) {
    if (!file) return;
    setInspection(undefined);
    setConfirmed(false);
    return work(
      async () => {
        if (file.size > 128_000)
          throw new Error('Recipe files must be 128 KB or smaller.');
        return file.text();
      },
      (value) => {
        setText(value);
        setRemoval(undefined);
      },
    );
  }
  function fork() {
    if (selected)
      edit(
        JSON.stringify(
          {
            ...selected,
            id: `${selected.id.slice(0, 60)}-copy-${crypto.randomUUID().slice(0, 8)}`,
            title: `${selected.title.slice(0, 113)} (copy)`,
            version: '1.0.0',
          },
          null,
          2,
        ),
      );
  }
  function inspect() {
    setInspection(undefined);
    setConfirmed(false);
    return work(async () => {
      if (new TextEncoder().encode(text).byteLength > 128_000)
        throw new Error('Recipe JSON must be 128 KB or smaller.');
      return apiJsonPost<RecipeInspection>('/api/app/recipes', {
        action: 'inspect',
        manifest: JSON.parse(text),
      });
    }, setInspection);
  }
  function install() {
    if (!inspection || (inspection.update && !confirmed)) return;
    const request = {
      action: inspection.update ? 'update' : 'install',
      manifest: inspection.recipe,
      expectedDigest: inspection.digest,
      ...(inspection.update
        ? { expectedInstalledDigest: inspection.update.digest }
        : {}),
    };
    return work(
      () => apiJsonPost<{ recipe: Recipe }>('/api/app/recipes', request),
      (result) => onInstalled(result.recipe),
    );
  }
  function reviewRemoval() {
    if (!selected) return;
    setInspection(undefined);
    setConfirmed(false);
    return work(
      () =>
        apiJsonPost<RecipeRemovalReview>('/api/app/recipes', {
          action: 'review-remove',
          recipeId: selected.id,
        }),
      setRemoval,
    );
  }
  function remove() {
    if (!removal || !confirmed) return;
    const retained = removal;
    return work(
      () =>
        apiJsonPost('/api/app/recipes', {
          action: 'remove',
          recipeId: retained.recipe.id,
          expectedDigest: retained.digest,
        }),
      () => onRemoved(retained.recipe),
    );
  }
  function acceptBuilt(result: RecipeInspection) {
    edit(JSON.stringify(result.recipe, null, 2));
    setInspection(result);
  }
  function dismissRemoval() {
    setRemoval(undefined);
    setError('');
    setConfirmed(false);
  }
  return {
    text,
    inspection,
    removal,
    busy,
    error,
    confirmed,
    setConfirmed,
    edit,
    fork,
    loadFile,
    inspect,
    install,
    reviewRemoval,
    remove,
    acceptBuilt,
    dismissRemoval,
  };
}
export type RecipeLibraryState = ReturnType<typeof useRecipeLibrary>;
