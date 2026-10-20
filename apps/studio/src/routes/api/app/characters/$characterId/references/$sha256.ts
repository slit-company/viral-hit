import { createFileRoute } from '@tanstack/react-router';
import { readCharacterReference } from '@/core/characters/library.server';

export const Route = createFileRoute('/api/app/characters/$characterId/references/$sha256')({ server: { handlers: {
  GET: async ({ params }) => {
    try {
      const { reference, bytes } = await readCharacterReference(params.characterId, params.sha256);
      return new Response(new Uint8Array(bytes), { headers: { 'Content-Type': reference.mimeType, 'Cache-Control': 'private, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' } });
    } catch { return Response.json({ error: 'Reference not found' }, { status: 404 }); }
  },
} } });

