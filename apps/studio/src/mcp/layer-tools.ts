import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { renderTimelineLayers, zipTimelineLayers } from '@/core/editor/layer-export.server';
import { loadProjectTimeline } from '@/core/editor/timeline-state';
import { withToolErrors } from './tool-results';

export function registerLayerTools(server: McpServer, project: (projectId?: string) => Promise<{ id: string }>) {
  server.registerTool('viral_hit_editor_render_layers', {
    description: 'Export the timeline as separate layers in one ZIP written to a new absolute outputPath: picture.mp4 (base track with transitions), overlays.mov and captions.mov on transparency (QuickTime Animation RGBA, spoken-word highlights included), captions.srt and one WAV per audio role (voice, music, sfx, source). Every file spans the whole timeline so they stack back into the same video in another editor. Nothing is added to the project.',
    inputSchema: z.object({ projectId: z.string().min(1).max(128).optional(), outputPath: z.string().min(2).max(4096).refine(value => isAbsolute(value) && value.toLowerCase().endsWith('.zip'), 'Use a new absolute path ending in .zip') }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, withToolErrors(async ({ projectId, outputPath }) => {
    const { id } = await project(projectId);
    const timeline = await loadProjectTimeline(id);
    if (!timeline || timeline.document.duration <= 0) throw new Error('The timeline is empty.');
    const directory = await mkdtemp(join(tmpdir(), 'vh-layers-'));
    try {
      const files = await renderTimelineLayers({ projectId: id, document: timeline.document, directory });
      await zipTimelineLayers(files, outputPath, timeline.document.name);
      return { outputPath, bytes: (await stat(outputPath)).size, revision: timeline.version, files: files.map(({ name, kind, description }) => ({ name, kind, description })) };
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }));
}
