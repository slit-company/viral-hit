import { createFileRoute } from '@tanstack/react-router';
import { readAssetSpeechWords } from '@/core/effects/speech-words.server';

type Context = { params: { projectId: string; assetId: string } };

/** Word timing a voice provider returned with this audio, for captions; null when there is none. */
async function GET({ params }: Context) {
  try { return Response.json({ words: await readAssetSpeechWords(params) }, { headers: { 'Cache-Control': 'no-store' } }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Speech timing is unavailable.' }, { status: 404 }); }
}
export const Route = createFileRoute('/api/app/projects/$projectId/assets/$assetId/speech-words')({ server: { handlers: { GET } } });
