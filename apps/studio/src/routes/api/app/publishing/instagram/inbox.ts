import { createFileRoute } from '@tanstack/react-router';
import { instagramInboxHttp } from '../-instagram-inbox-http.server';

export const Route = createFileRoute('/api/app/publishing/instagram/inbox')({ server: { handlers: {
  GET: ({ request }) => instagramInboxHttp.read(request),
  POST: ({ request }) => instagramInboxHttp.change(request),
} } });
