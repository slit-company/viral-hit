import { z } from 'zod';

export const MAX_DIALOGUE_LINES = 40;
export const DIALOGUE_REQUEST_PREFIX = 'dialogue:';
export type DialogueLine = { speaker: string; text: string };

/**
 * One line per spoken turn, written "Name: words" (a full-width colon works too). A line without a name
 * continues the previous turn; text before any name belongs to "Narrator".
 */
export function parseDialogueScript(script: string): DialogueLine[] {
  const lines: DialogueLine[] = [];
  for (const raw of script.split(/\r?\n/)) {
    const text = raw.trim();
    if (!text) continue;
    const match = /^([^:：]{1,40})[:：]\s*(.+)$/.exec(text);
    if (match) lines.push({ speaker: match[1].trim(), text: match[2].trim() });
    else if (lines.length) lines[lines.length - 1].text += ' ' + text;
    else lines.push({ speaker: 'Narrator', text });
  }
  return lines;
}
export const dialogueSpeakers = (lines: readonly DialogueLine[]) => [...new Set(lines.map(line => line.speaker))];

export const dialogueRequest = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list') }).strict(),
  /** Queues one text-to-speech generation per line, each with its speaker's voice (paid). */
  z.object({
    action: z.literal('produce'), requestId: z.string().uuid(), modelId: z.string().min(1).max(200), script: z.string().trim().min(1).max(20_000),
    cast: z.record(z.string().trim().min(1).max(40), z.string().trim().min(1).max(200)),
  }).strict(),
  /** Places finished lines one after another as voice clips, with captions from their word timing. */
  z.object({ action: z.literal('place'), requestId: z.string().uuid(), gap: z.number().finite().min(0).max(3).default(0.3), captions: z.boolean().default(true) }).strict(),
]);
export type DialogueRequest = z.input<typeof dialogueRequest>;

export type DialogueLineView = DialogueLine & { index: number; voice: string; state: string; error: string | null; assetId?: string; url?: string; duration?: number };
export type DialogueView = { requestId: string; runId: string; modelId: string; createdAt: number; lines: DialogueLineView[] };
