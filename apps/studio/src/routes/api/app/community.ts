import { createFileRoute } from '@tanstack/react-router';
import { ZodError } from 'zod';
import { MAX_CATALOG_BYTES, communityRequest } from '@/core/community/contract';
import { changeCommunity } from '@/core/community/service.server';
import { CatalogConflictError } from '@/core/community/storage.server';
import {
  readRequestJsonWithLimit,
  RequestBodyTooLargeError,
} from '@/lib/request-body-limit';
import { validateTrustedWorkspaceJsonMutation } from '@/lib/trusted-local-request';

export const Route = createFileRoute('/api/app/community')({
  server: {
    handlers: {
      GET: async () => {
        try {
          return Response.json(await changeCommunity({ action: 'list' }), {
            headers: { 'Cache-Control': 'no-store' },
          });
        } catch {
          return Response.json(
            { error: 'Catalogs are unavailable' },
            { status: 503 },
          );
        }
      },
      POST: async ({ request }) => {
        const trust = validateTrustedWorkspaceJsonMutation(request);
        if (!trust.ok)
          return Response.json(
            { error: trust.message },
            { status: trust.status },
          );
        try {
          return Response.json(
            await changeCommunity(
              communityRequest.parse(
                await readRequestJsonWithLimit(
                  request,
                  MAX_CATALOG_BYTES + 4096,
                ),
              ),
              request.signal,
            ),
          );
        } catch (error) {
          const message =
            error instanceof ZodError
              ? error.issues
                  .slice(0, 4)
                  .map((issue) => issue.path.join('.') + ': ' + issue.message)
                  .join('; ')
              : error instanceof Error
                ? error.message
                : 'Catalog request failed';
          return Response.json(
            { error: message.slice(0, 1000) },
            {
              status:
                error instanceof CatalogConflictError
                  ? 409
                  : error instanceof RequestBodyTooLargeError
                    ? 413
                    : 400,
            },
          );
        }
      },
    },
  },
});
