import { createFileRoute } from '@tanstack/react-router';
import { createInstagramAccountHttp } from '../-instagram-account-http.server';

const http = createInstagramAccountHttp();
export const Route = createFileRoute('/api/app/publishing/instagram/accounts')({ server: { handlers: {
  GET: ({ request }) => http.read(request),
  POST: ({ request }) => http.change(request),
} } });
