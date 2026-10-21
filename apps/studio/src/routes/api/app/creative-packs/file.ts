import { createFileRoute } from '@tanstack/react-router';
import { uploadPack } from './-http.server';
export const Route = createFileRoute('/api/app/creative-packs/file')({ server: { handlers: { POST: ({ request }) => uploadPack(request) } } });
