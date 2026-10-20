import { createFileRoute } from '@tanstack/react-router';
import { ZodError } from 'zod';
import { characterRequest, referenceRoles, MAX_CHARACTER_REFERENCES, MAX_REFERENCE_BYTES, type CharacterRequest } from '@/core/characters/contract';
import type { UploadedReference } from '@/core/characters/library.server';
import { changeCharacters } from '@/core/characters/service.server';
import { CharacterConflictError } from '@/core/characters/storage.server';
import { validateTrustedWorkspaceJsonMutation, validateTrustedWorkspaceMutation } from '@/lib/trusted-local-request';
import { readRequestJsonWithLimit, RequestBodyTooLargeError } from '@/lib/request-body-limit';

const MAX_UPLOAD_BYTES = 10 * MAX_REFERENCE_BYTES;
const message = (error: unknown) => error instanceof ZodError ? error.issues.slice(0, 6).map(issue => (issue.path.length ? issue.path.join('.') + ': ' : '') + issue.message).join('\n') : error instanceof Error ? error.message : 'Character request failed';
const status = (error: unknown) => error instanceof RequestBodyTooLargeError ? 413 : error instanceof CharacterConflictError ? 409 : 400;

/** Browsers send image bytes; server file paths are only accepted from local MCP and CLI hosts. */
function rejectPaths(request: CharacterRequest) {
  if ((request.action === 'create' || request.action === 'add_references') && request.references.some(source => 'path' in source)) throw new Error('Upload the image or choose a project image instead of a file path');
  if (request.action === 'export' || request.action === 'import') throw new Error('Download or upload character files instead of using server paths');
  return request;
}

async function multipart(request: Request) {
  // FormData buffers the body, so the declared size must exist and fit before reading.
  const length = Number(request.headers.get('content-length'));
  if (!Number.isFinite(length) || length <= 0) throw new Error('Uploads need a Content-Length header');
  if (length > MAX_UPLOAD_BYTES) throw new RequestBodyTooLargeError(MAX_UPLOAD_BYTES);
  const form = await request.formData();
  const parsed = rejectPaths(characterRequest.parse(JSON.parse(String(form.get('request') ?? '{}'))));
  if (parsed.action !== 'create' && parsed.action !== 'add_references') throw new Error('Uploads are for creating a character or adding references');
  const files = form.getAll('file').filter((item): item is File => item instanceof File);
  const roles = JSON.parse(String(form.get('roles') ?? '[]')) as unknown[];
  if (files.length > MAX_CHARACTER_REFERENCES || roles.length !== files.length) throw new Error('Send one role per uploaded image');
  const uploads: UploadedReference[] = [];
  for (const [index, file] of files.entries()) {
    const role = roles[index];
    if (!referenceRoles.includes(role as never)) throw new Error('Unknown reference role');
    if (file.size > MAX_REFERENCE_BYTES) throw new Error('Reference images must be up to 20 MB');
    uploads.push({ bytes: new Uint8Array(await file.arrayBuffer()), filename: file.name || 'reference', role: role as UploadedReference['role'] });
  }
  return changeCharacters(parsed, uploads);
}

export const Route = createFileRoute('/api/app/characters/')({ server: { handlers: {
  GET: async ({ request }) => {
    try {
      const archived = new URL(request.url).searchParams.get('archived') === '1';
      return Response.json(await changeCharacters({ action: 'list', includeArchived: archived }), { headers: { 'Cache-Control': 'no-store' } });
    } catch { return Response.json({ error: 'Characters are unavailable' }, { status: 503 }); }
  },
  POST: async ({ request }) => {
    const type = request.headers.get('content-type')?.split(';')[0].trim();
    const trust = type === 'multipart/form-data' ? validateTrustedWorkspaceMutation(request) : validateTrustedWorkspaceJsonMutation(request);
    if (!trust.ok) return Response.json({ error: trust.message }, { status: trust.status });
    try {
      if (type === 'multipart/form-data') return Response.json(await multipart(request));
      const body = rejectPaths(characterRequest.parse(await readRequestJsonWithLimit(request, 64_000)));
      return Response.json(await changeCharacters(body));
    } catch (error) { return Response.json({ error: message(error).slice(0, 1500) }, { status: status(error) }); }
  },
} } });

