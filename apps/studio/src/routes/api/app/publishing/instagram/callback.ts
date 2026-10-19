import { createFileRoute } from '@tanstack/react-router';
import { createInstagramAccountHttp } from '../-instagram-account-http.server';

const http = createInstagramAccountHttp();
export const Route = createFileRoute('/api/app/publishing/instagram/callback')({ server: { handlers: {
  GET: ({ request }) => http.callback(request),
} } });
