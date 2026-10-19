export type ViralHitCommandOrigin = 'ui' | 'mcp' | 'cli' | 'system';

export type ViralHitCommandEnvelope<TCommand> = {
  commandId: string;
  projectId: string;
  origin: ViralHitCommandOrigin;
  expectedRevision?: number | null;
  idempotencyKey?: string | null;
  command: TCommand;
};

export type ViralHitCommandSuccess<TData = undefined> = {
  ok: true;
  commandId: string;
  projectId: string;
  origin: ViralHitCommandOrigin;
  changedIds: string[];
  warnings: string[];
  revision?: number;
  jobId?: string;
  editorUrl?: string;
  data: TData;
};

export type ViralHitCommandFailure = {
  ok: false;
  commandId: string;
  projectId: string;
  origin: ViralHitCommandOrigin;
  changedIds: [];
  warnings: string[];
  code:
    | 'INVALID_COMMAND'
    | 'NOT_FOUND'
    | 'REVISION_CONFLICT'
    | 'COMMAND_FAILED';
  message: string;
  revision?: number;
};

export type ViralHitCommandResult<TData = undefined> =
  | ViralHitCommandSuccess<TData>
  | ViralHitCommandFailure;

export class ViralHitCommandError extends Error {
  readonly code: ViralHitCommandFailure['code'];

  constructor(
    code: ViralHitCommandFailure['code'],
    message: string
  ) {
    super(message);
    this.name = 'ViralHitCommandError';
    this.code = code;
  }
}

export const createCommandId = () =>
  globalThis.crypto?.randomUUID?.() ??
  `cmd-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

export const createCommandFailure = ({
  commandId,
  projectId,
  origin,
  code,
  message,
  revision,
  warnings = [],
}: {
  commandId: string;
  projectId: string;
  origin: ViralHitCommandOrigin;
  code: ViralHitCommandFailure['code'];
  message: string;
  revision?: number;
  warnings?: string[];
}): ViralHitCommandFailure => ({
  ok: false,
  commandId,
  projectId,
  origin,
  changedIds: [],
  warnings,
  code,
  message,
  ...(typeof revision === 'number' ? { revision } : {}),
});

export const createCommandSuccess = <TData>({
  commandId,
  projectId,
  origin,
  changedIds = [],
  warnings = [],
  revision,
  jobId,
  editorUrl,
  data,
}: {
  commandId: string;
  projectId: string;
  origin: ViralHitCommandOrigin;
  changedIds?: string[];
  warnings?: string[];
  revision?: number;
  jobId?: string;
  editorUrl?: string;
  data: TData;
}): ViralHitCommandSuccess<TData> => ({
  ok: true,
  commandId,
  projectId,
  origin,
  changedIds: Array.from(new Set(changedIds)),
  warnings,
  ...(typeof revision === 'number' ? { revision } : {}),
  ...(jobId ? { jobId } : {}),
  ...(editorUrl ? { editorUrl } : {}),
  data,
});
