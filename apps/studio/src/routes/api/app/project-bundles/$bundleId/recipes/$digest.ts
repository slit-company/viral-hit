import { createFileRoute } from '@tanstack/react-router';
import { readImportReview } from '@/core/projects/bundles/import.server';
import { recipeDigest } from '@/core/harness/recipe-database.server';

export async function GET({ request, params }: { request: Request; params: { bundleId: string; digest: string } }) {
  const site = request.headers.get('sec-fetch-site'), origin = request.headers.get('origin');
  if ((site && site !== 'same-origin' && site !== 'none') || (origin && origin !== new URL(request.url).origin)) return new Response('Cross-site request rejected', { status: 403 });
  try {
    if (!/^[a-f0-9]{64}$/.test(params.digest)) throw Error('Invalid recipe digest');
    const { manifest } = await readImportReview(params.bundleId);
    const recipe = manifest.storyboards?.recipes.find(recipe => recipeDigest(recipe) === params.digest);
    if (!recipe) throw Error('Bundled recipe not found');
    return new Response(JSON.stringify(recipe, null, 2), { headers: {
      'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="${recipe.id}.recipe.json"`,
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ETag: `"${params.digest}"`,
    } });
  } catch { return Response.json({ error: 'Reviewed recipe is unavailable. Inspect the project file again.' }, { status: 404 }); }
}
export const Route = createFileRoute('/api/app/project-bundles/$bundleId/recipes/$digest')({ server: { handlers: { GET } } });
