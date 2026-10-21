import { createFileRoute } from '@tanstack/react-router';
import { listCreativePacks } from '@/core/creative-packs/service.server';
import { downloadPack } from './-http.server';
export const Route = createFileRoute('/api/app/creative-packs/')({ server: { handlers: {
  GET: async () => { try { return Response.json(await listCreativePacks(), { headers: { 'Cache-Control': 'no-store' } }); } catch { return Response.json({ error: 'Creative packs are unavailable' }, { status: 503 }); } },
  POST: ({ request }) => downloadPack(request),
} } });
