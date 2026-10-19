import { z } from 'zod';

export const executionPolicy = z.object({
  timeoutMs: z.number().int().min(1000).max(300000),
  // An opt-in promise: interruption leaves no unknown remote submission.
  abortOnCancel: z.boolean().default(false),
}).strict();
export type ExecutionPolicy = z.infer<typeof executionPolicy>;
export function executionTimeout(policy?: ExecutionPolicy) {
  return policy ? executionPolicy.parse(policy).timeoutMs : 60000;
}
