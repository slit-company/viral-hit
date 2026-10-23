import { createFileRoute } from '@tanstack/react-router';
import { createPerformanceHttp } from '../-performance-http.server';

const http = createPerformanceHttp();
export const Route = createFileRoute('/api/app/projects/$projectId/performance')({ server: { handlers: {
  GET: ({ params, request }) => http.read(params.projectId, request),
  POST: ({ params, request }) => http.change(params.projectId, request),
} } });
