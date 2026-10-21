import { z } from 'zod';

const inputSchema = z.object({
  prompt: z.string().trim().min(1).max(12_000),
  video_url: z.string().url().max(4096),
  video_urls: z.array(z.string()).max(1).optional(),
  image_urls: z.array(z.string()).max(0).optional(),
  audio_urls: z.array(z.string()).max(0).optional(),
  analysis_depth: z.enum(['standard', 'deep']).optional(),
  max_output_tokens: z.number().int().min(256).max(8192).optional(),
}).superRefine((value, ctx) => {
  if (value.video_urls?.length && value.video_urls[0] !== value.video_url) ctx.addIssue({ code: 'custom', message: 'Analysis requires exactly one source video' });
});

/** The same validation runs before uploads and at the executable adapter boundary. */
export function validateInstalledAnalysisInput(input: unknown) {
  return inputSchema.parse(input);
}
