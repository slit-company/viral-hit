import { createFileRoute } from '@tanstack/react-router';
import { runtimePackagesGet, runtimePackagesPost } from './-http.server';
export const Route = createFileRoute('/api/app/runtime-packages/')({ server: { handlers: { GET: runtimePackagesGet, POST: ({request}) => runtimePackagesPost(request) } } });
