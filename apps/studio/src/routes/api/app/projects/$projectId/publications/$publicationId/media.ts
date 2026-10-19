import { createFileRoute } from '@tanstack/react-router';
import { publicationPreview } from '../../../../publishing/-preview-http.server';

export const Route = createFileRoute('/api/app/projects/$projectId/publications/$publicationId/media')({ server: { handlers: {
  GET: ({ params, request }) => publicationPreview(params.projectId, params.publicationId, request),
} } });
