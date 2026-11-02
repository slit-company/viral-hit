import { createReadStream } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { createFileRoute } from '@tanstack/react-router';
import { renderTimelineLayers, zipTimelineLayers } from '@/core/editor/layer-export.server';
import { loadProjectTimeline } from '@/core/editor/timeline-state';
import { getActiveProject } from '@/core/projects/projects';
import { validateTrustedWorkspaceMutation } from '@/lib/trusted-local-request';

type Context = { request: Request; params: { projectId: string } };

/** Renders the timeline's layers and streams them back as one ZIP; nothing is stored in the project. */
async function POST({ request, params }: Context) {
  const trust = validateTrustedWorkspaceMutation(request);
  if (!trust.ok) return Response.json({ error: trust.message }, { status: trust.status });
  if (!await getActiveProject({ projectId: params.projectId })) return Response.json({ error: 'Project not found' }, { status: 404 });
  const timeline = await loadProjectTimeline(params.projectId);
  if (!timeline || timeline.document.duration <= 0) return Response.json({ error: 'The timeline is empty.' }, { status: 400 });
  const directory = await mkdtemp(join(tmpdir(), 'vh-layers-'));
  try {
    const files = await renderTimelineLayers({ projectId: params.projectId, document: timeline.document, directory });
    const zipPath = join(directory, 'layers.zip');
    await zipTimelineLayers(files, zipPath, timeline.document.name);
    const stream = createReadStream(zipPath);
    stream.on('close', () => { void rm(directory, { recursive: true, force: true }); });
    const name = (timeline.document.name.replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^-+|-+$/g, '') || 'timeline') + '-layers.zip';
    return new Response(Readable.toWeb(stream) as ReadableStream, { headers: {
      'Content-Type': 'application/zip', 'Content-Length': String((await stat(zipPath)).size), 'Cache-Control': 'no-store',
      'Content-Disposition': `attachment; filename="layers.zip"; filename*=UTF-8''${encodeURIComponent(name)}`,
    } });
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    return Response.json({ error: error instanceof Error ? error.message.slice(0, 1000) : 'Layer export failed.' }, { status: 400 });
  }
}
export const Route = createFileRoute('/api/app/projects/$projectId/timeline/layers')({ server: { handlers: { POST } } });
