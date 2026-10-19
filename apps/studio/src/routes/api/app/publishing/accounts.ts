import { createFileRoute } from '@tanstack/react-router';
import { createAccountHttp } from './-account-http.server';

const http = createAccountHttp();
export const Route = createFileRoute('/api/app/publishing/accounts')({ server: { handlers: {
  GET: ({ request }) => http.read(request),
  POST: ({ request }) => http.change(request),
} } });
