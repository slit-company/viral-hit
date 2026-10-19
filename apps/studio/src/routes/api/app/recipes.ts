import { createFileRoute } from '@tanstack/react-router';
import { loadRecipes } from '@/core/harness/recipe-registry';
export const Route = createFileRoute('/api/app/recipes')({ server: { handlers: { GET: async () => {
  try { return Response.json({ recipes: await loadRecipes() }, { headers: { 'Cache-Control': 'no-store' } }); }
  catch { return Response.json({ error: 'Recipe catalog is invalid or unavailable; inspect the configured recipe directory.' }, { status: 503 }); }
} } } });
