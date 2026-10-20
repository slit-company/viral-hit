import { createFileRoute } from '@tanstack/react-router';
import { Readable } from 'node:stream';
import { openProjectBundleDownload } from '@/core/projects/bundles/download.server';
export async function GET({ request, params }: { request: Request; params: { bundleId: string } }) {
  const site = request.headers.get('sec-fetch-site'), origin = request.headers.get('origin');
  if ((site && site !== 'same-origin' && site !== 'none') || (origin && origin !== new URL(request.url).origin)) return new Response('Cross-site request rejected', { status: 403 });
  try {
    const { file, receipt } = await openProjectBundleDownload(params.bundleId, AbortSignal.any([request.signal, AbortSignal.timeout(10 * 60_000)]));
    return new Response(Readable.toWeb(file.createReadStream()) as ReadableStream, { headers: {
      'Content-Type': 'application/x-tar', 'Content-Length': String(receipt.sizeBytes),
      'Content-Disposition': `attachment; filename="project-${params.bundleId}.viralhit.tar"`,
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ETag: `"${receipt.sha256}"`,
    } });
  } catch { return Response.json({ error: 'Prepared project file is unavailable. Prepare it again.' }, { status: 404 }); }
}
export const Route = createFileRoute('/api/app/project-bundles/$bundleId/download')({ server: { handlers: { GET } } });
