import { z } from 'zod';
import { projectMediaPin } from '../harness/project-media-input-schema';

const time = z.number().finite().min(0).max(3600);
const sha = z.string().regex(/^[a-f0-9]{64}$/);
/** Public interchange for machine-estimated speech; validation does not certify recognition accuracy. */
export const transcriptSchema = z.object({
  schemaVersion: z.literal(1), basis: z.literal('machine-transcription'),
  source: projectMediaPin.refine(value => value.kind === 'video' || value.kind === 'audio'),
  engine: z.object({ id: z.string().min(1).max(100), version: z.string().min(1).max(100), model: z.string().min(1).max(200), cliSha256: sha.optional(), modelSha256: sha.optional() }).strict(),
  language: z.string().regex(/^[a-z]{2,3}$/), range: z.object({ start: time, end: time }).strict(),
  segments: z.array(z.object({ start: time, end: time, text: z.string().trim().min(1).max(4000) }).strict()).max(120),
  timingAdjusted: z.number().int().min(0).max(120), segmentsOmitted: z.number().int().min(0).max(120),
}).strict().superRefine((value, ctx) => {
  if (value.range.end - value.range.start < .01 || value.range.end - value.range.start > 120.001) ctx.addIssue({ code: 'custom', message: 'Invalid transcript range' });
  let previous = value.range.start;
  for (const segment of value.segments) {
    if (segment.start < previous || segment.end - segment.start < .0099 || segment.end > value.range.end) ctx.addIssue({ code: 'custom', message: 'Transcript segments overlap or exceed the selected range' });
    previous = segment.end;
  }
});
export type Transcript = z.infer<typeof transcriptSchema>;
export function readTranscriptOutput(raw: string | null) {
  if (!raw) return null;
  try { const parsed = transcriptSchema.safeParse(JSON.parse(raw).transcript); return parsed.success ? parsed.data : null; }
  catch { return null; }
}
function stamp(seconds: number) {
  const ms = Math.round(seconds * 1000);
  return [Math.floor(ms / 3600000), Math.floor(ms / 60000) % 60, Math.floor(ms / 1000) % 60].map(n => String(n).padStart(2, '0')).join(':') + ',' + String(ms % 1000).padStart(3, '0');
}
/** SRT timing starts at zero for the selected source range, matching the editable sequence. */
export function transcriptSrt(raw: Transcript) {
  const transcript = transcriptSchema.parse(raw);
  return transcript.segments.map((segment, index) => {
    const text = segment.text.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `${index + 1}\n${stamp(segment.start - transcript.range.start)} --> ${stamp(segment.end - transcript.range.start)}\n${text}\n`;
  }).join('\n');
}
