import { ApiError, apiJsonPost } from '@/lib/api-client';

import {
  createCommandId,
  type ViralHitCommandResult,
} from './contracts';
import type { ViralHitCommand, ViralHitCommandData } from './executor';

const isCommandResult = (
  value: unknown
): value is ViralHitCommandResult<ViralHitCommandData> =>
  Boolean(
    value &&
      typeof value === 'object' &&
      typeof (value as { ok?: unknown }).ok === 'boolean' &&
      typeof (value as { commandId?: unknown }).commandId === 'string'
  );

export async function executeProjectCommand({
  projectId,
  command,
  expectedRevision,
  commandId = createCommandId(),
  idempotencyKey = commandId,
  keepalive = false,
}: {
  projectId: string;
  command: ViralHitCommand;
  expectedRevision?: number | null;
  commandId?: string;
  idempotencyKey?: string;
  keepalive?: boolean;
}): Promise<ViralHitCommandResult<ViralHitCommandData>> {
  try {
    return await apiJsonPost<ViralHitCommandResult<ViralHitCommandData>>(
      `/api/app/projects/${encodeURIComponent(projectId)}/commands`,
      {
        commandId,
        expectedRevision,
        idempotencyKey,
        command,
      },
      { keepalive }
    );
  } catch (error) {
    if (error instanceof ApiError && isCommandResult(error.data)) {
      return error.data;
    }
    throw error;
  }
}
