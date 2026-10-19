import { createFileRoute } from '@tanstack/react-router';
import { createAccountHttp } from '../-account-http.server';

const http = createAccountHttp();
export const Route = createFileRoute('/api/app/publishing/youtube/callback')({ server: { handlers: {
  GET: ({ request }) => http.callback(request),
} } });
