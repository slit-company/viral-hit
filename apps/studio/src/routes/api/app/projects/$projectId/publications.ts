import { createFileRoute } from '@tanstack/react-router';
import { createPublicationHttp } from '../../publishing/-publication-http.server';

const http = createPublicationHttp();
export const Route = createFileRoute('/api/app/projects/$projectId/publications')({ server: { handlers: {
  GET: ({ params, request }) => http.read(params.projectId, request),
  POST: ({ params, request }) => http.change(params.projectId, request),
} } });
