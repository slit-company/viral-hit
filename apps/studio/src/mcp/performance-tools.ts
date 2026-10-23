import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { changePerformance, readPerformance, readPublicationPerformance } from '../core/measurement/application.server';
import { measurementRequest, MeasurementRequestError } from '../core/measurement/contract';
import { publicationProjectId } from '../core/publishing/requests';
import { withToolErrors } from './tool-results';

async function safe<T>(operation: () => Promise<T>) {
  try { return await operation(); }
  catch (error) { throw error instanceof MeasurementRequestError ? error : new Error('Performance service unavailable; select an active project and review its publications'); }
}

export function registerPerformanceTools(server: McpServer, project: (projectId?: string) => Promise<{ id: string }>) {
  server.registerTool('viral_hit_performance_read', {
    description: 'Read creative performance for delivered publications. Without publicationId: one row per publication with declared metric names, the latest and previous usable readings, their change, the last attempt and linked asset IDs, so you can compare which creative did better. With publicationId: every versioned reading, newest first, including unavailable attempts. Reads local records only; it never contacts a destination.',
    inputSchema: z.object({ projectId: publicationProjectId.optional(), publicationId: z.uuid().optional() }).strict(),
    annotations: { readOnlyHint: true, idempotentHint: true },
  }, withToolErrors(async ({ projectId, publicationId }) => safe(async () => {
    const id = (await project(projectId)).id;
    return publicationId ? readPublicationPerformance(id, { publicationId }) : readPerformance(id);
  })));
  server.registerTool('viral_hit_performance_change', {
    description: 'Add a performance reading to a delivered publication. collect asks its connector for a read-only reading (built-in YouTube/Instagram or an installed connector that declares measurement); a repeat within one minute returns the previous reading. Numbers a destination does not report are listed as missing, never zero. record stores numbers the user observed elsewhere (lowercase snake_case names such as views, likes, watch_time_seconds) with observedAt and a unique requestKey; repeating the same key and content is safe. Neither action changes the publication, its media or any remote post.',
    inputSchema: z.object({ projectId: publicationProjectId.optional(), request: measurementRequest }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, withToolErrors(async ({ projectId, request }) => safe(async () => changePerformance((await project(projectId)).id, request, 'mcp'))));
}
