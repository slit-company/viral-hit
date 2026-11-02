export const jsonResult = (result: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
  structuredContent: { result },
});

export class ViralHitMcpToolError extends Error {
  readonly status: number;
  readonly details: Record<string, unknown>;

  constructor(status: number, details: Record<string, unknown>) {
    super(
      typeof details.error === 'string'
        ? details.error
        : `Viral Hit request failed with status ${status}.`
    );
    this.name = 'ViralHitMcpToolError';
    this.status = status;
    this.details = details;
  }
}

/** An agent generation waiting for, or refused by, a person; see core/agent. */
const approvalOf = (error: unknown) =>
  error instanceof Error && error.name === 'AgentApprovalRequired' && 'approval' in error
    ? (error.approval as { id: string; state: string })
    : null;

export const errorResult = (error: unknown) => approvalOf(error) ? ({
  content: [{ type: 'text' as const, text: (error as Error).message }],
  isError: true,
  structuredContent: { error: { message: (error as Error).message, status: 409, details: { approvalId: approvalOf(error)!.id, approvalState: approvalOf(error)!.state } } },
}) : ({
  content: [
    {
      type: 'text' as const,
      text: error instanceof Error ? error.message : 'ViralHit tool failed.',
    },
  ],
  isError: true,
  structuredContent: {
    error:
      error instanceof ViralHitMcpToolError
        ? {
            message: error.message,
            status: error.status,
            details: error.details,
          }
        : {
            message:
              error instanceof Error ? error.message : 'ViralHit tool failed.',
          },
  },
});

export const withToolErrors = <TArgs, TResult>(
  handler: (args: TArgs) => Promise<TResult> | TResult
) => async (args: TArgs) => {
  try {
    return jsonResult(await handler(args));
  } catch (error) {
    return errorResult(error);
  }
};
