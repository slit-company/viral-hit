import { createFileRoute } from '@tanstack/react-router';
import { ZodError } from 'zod';
import { changeSkillLibrary, SkillConflictError } from '@/core/skills/library.server';
import { MAX_SKILL_FILE_BYTES, skillLibraryRequest } from '@/core/skills/package';
import { readRequestJsonWithLimit, RequestBodyTooLargeError } from '@/lib/request-body-limit';
import { validateTrustedWorkspaceJsonMutation } from '@/lib/trusted-local-request';

export const Route = createFileRoute('/api/app/skills')({ server: { handlers: {
  GET: async () => {
    try { return Response.json(await changeSkillLibrary({ action: 'list' }), { headers: { 'Cache-Control': 'no-store' } }); }
    catch { return Response.json({ error: 'Skills are unavailable. Check the skills folder.' }, { status: 503 }); }
  },
  POST: async ({ request }) => {
    const trust = validateTrustedWorkspaceJsonMutation(request);
    if (!trust.ok) return Response.json({ error: trust.message }, { status: trust.status });
    try { return Response.json(await changeSkillLibrary(skillLibraryRequest.parse(await readRequestJsonWithLimit(request, MAX_SKILL_FILE_BYTES + 4096)))); }
    catch (error) {
      const message = error instanceof ZodError ? error.issues.slice(0, 6).map(issue => issue.path.join('.') + ': ' + issue.message).join('\n') : error instanceof Error ? error.message : 'Skill request failed';
      return Response.json({ error: message.slice(0, 1500) }, { status: error instanceof RequestBodyTooLargeError ? 413 : error instanceof SkillConflictError ? 409 : 400 });
    }
  },
} } });
