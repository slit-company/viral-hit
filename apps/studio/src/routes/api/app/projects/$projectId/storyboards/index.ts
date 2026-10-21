import { createFileRoute } from '@tanstack/react-router';
import { storyboardsGet, storyboardsPost } from './-http.server';
export const Route = createFileRoute('/api/app/projects/$projectId/storyboards/')({
  server: { handlers: { GET: ({ params }) => storyboardsGet(params.projectId), POST: ({ params, request }) => storyboardsPost(params.projectId, request) } },
});
