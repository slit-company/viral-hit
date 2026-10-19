import { publicationForPreview } from '@/core/publishing/application.server';
import { openProjectPublicationMedia } from '@/core/publishing/project-media.server';
import { parseByteRange } from '@/lib/byte-range';

/** Native <video> cannot attach the workspace header; prohibit cross-site media embedding. */
export async function publicationPreview(projectId: string, publicationId: string, request: Request) {
  const headers = new Headers({ 'Cache-Control': 'no-store', 'Cross-Origin-Resource-Policy': 'same-origin', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
  const site = request.headers.get('sec-fetch-site'), origin = request.headers.get('origin');
  if ((site && !['same-origin', 'none'].includes(site)) || (origin && origin !== new URL(request.url).origin)) return new Response(null, { status: 403, headers });
  const controller = new AbortController(), signal = AbortSignal.any([controller.signal, request.signal]);
  try {
    const digest = new URL(request.url).searchParams.get('digest') ?? '';
    if (!/^[a-f0-9]{64}$/.test(digest)) return new Response(null, { status: 400, headers });
    const spec = await publicationForPreview(projectId, publicationId, digest, signal), asset = spec.assets[0];
    const rangeHeader = request.headers.get('range'), range = parseByteRange(rangeHeader, asset.sizeBytes);
    headers.set('Accept-Ranges', 'bytes'); headers.set('Content-Type', asset.contentType);
    if (rangeHeader && !range) { headers.set('Content-Range', `bytes */${asset.sizeBytes}`); return new Response(null, { status: 416, headers }); }
    let offset = range?.start ?? 0; const end = range?.end ?? asset.sizeBytes - 1;
    const read = async () => {
      const media = openProjectPublicationMedia();
      try { return await media.read(spec, 0, offset, Math.min(8 * 1024 * 1024, end - offset + 1), AbortSignal.any([signal, AbortSignal.timeout(30000)])); }
      finally { media.close(); }
    };
    const first = await read();
    headers.set('Content-Length', String(end - offset + 1));
    if (range) headers.set('Content-Range', `bytes ${offset}-${end}/${asset.sizeBytes}`);
    const stream = new ReadableStream<Uint8Array>({
      start(output) { output.enqueue(first); offset += first.length; if (offset > end) output.close(); },
      async pull(output) {
        try { const bytes = await read(); signal.throwIfAborted(); output.enqueue(bytes); offset += bytes.length; if (offset > end) output.close(); }
        catch { output.error(new Error('Retained video unavailable')); }
      },
      cancel() { controller.abort(); },
    });
    return new Response(stream, { status: range ? 206 : 200, headers });
  } catch { return new Response(null, { status: 404, headers }); }
}
