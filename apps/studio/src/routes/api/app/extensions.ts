import { createFileRoute } from '@tanstack/react-router';
import { extensionDiagnostics } from '@/core/extensions/diagnostics.server';
export const Route = createFileRoute('/api/app/extensions')({ server: { handlers: {
  GET: async () => Response.json(await extensionDiagnostics(), { headers: { 'Cache-Control': 'no-store' } }),
} } });
