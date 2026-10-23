import { useEffect, useState } from 'react';

const RECIPE_ID = /^[a-z][a-z0-9-]{0,79}$/;

/**
 * Reads ?recipe= once, for example from a template card, and removes it from the address so a
 * reload does not reopen Runs. Returns the linked id so the caller can report an uninstalled recipe.
 */
export function useRecipeLink(onLink: (recipeId: string) => void) {
  const [linked, setLinked] = useState<string>();
  useEffect(() => {
    const url = new URL(window.location.href);
    const recipeId = url.searchParams.get('recipe');
    if (recipeId === null) return;
    url.searchParams.delete('recipe');
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
    if (!RECIPE_ID.test(recipeId)) return;
    setLinked(recipeId);
    onLink(recipeId);
  }, []);
  return linked;
}
