/**
 * How each video and image model family reads a prompt. The rules follow the vendors' published
 * prompting guides: what comes first, what length works, and which controls exist natively.
 * Ranks are editorial defaults used only when the person chooses "Auto"; every choice stays visible.
 */
export type PromptStyle = 'subject-first' | 'paragraph' | 'motion-first' | 'chronological' | 'bracket' | 'concise';
export type ModelFamily = {
  id: string;
  match: RegExp;
  kind: 'video' | 'image';
  style: PromptStyle;
  maxPromptChars: number;
  rank: number;
  /** Speaks audio cues and dialogue when its audio control is on. */
  nativeAudio?: boolean;
  /** Good with people and faces from a reference image. */
  identity?: boolean;
};

export const MODEL_FAMILIES: readonly ModelFamily[] = [
  { id: 'cinema-studio', match: /cinema-studio/, kind: 'video', style: 'paragraph', maxPromptChars: 2000, rank: 96, nativeAudio: true, identity: true },
  { id: 'seedance', match: /seedance/, kind: 'video', style: 'subject-first', maxPromptChars: 1500, rank: 95, nativeAudio: true, identity: true },
  { id: 'veo', match: /veo|gemini-omni/, kind: 'video', style: 'paragraph', maxPromptChars: 2000, rank: 93, nativeAudio: true },
  { id: 'kling', match: /kling/, kind: 'video', style: 'subject-first', maxPromptChars: 2500, rank: 92, nativeAudio: true, identity: true },
  { id: 'minimax', match: /minimax|hailuo/, kind: 'video', style: 'bracket', maxPromptChars: 2000, rank: 88 },
  { id: 'runway', match: /runway|gen4|aleph/, kind: 'video', style: 'motion-first', maxPromptChars: 1000, rank: 86 },
  { id: 'wan', match: /wan-/, kind: 'video', style: 'subject-first', maxPromptChars: 1500, rank: 84 },
  { id: 'grok-video', match: /grok-imagine-video|grok-imagine-video-v/, kind: 'video', style: 'concise', maxPromptChars: 800, rank: 82, nativeAudio: true },
  { id: 'ltx', match: /ltx/, kind: 'video', style: 'chronological', maxPromptChars: 2500, rank: 80, nativeAudio: true },
  { id: 'video', match: /./, kind: 'video', style: 'paragraph', maxPromptChars: 1500, rank: 60 },
  { id: 'soul', match: /soul/, kind: 'image', style: 'paragraph', maxPromptChars: 1500, rank: 93, identity: true },
  { id: 'nano-banana', match: /nano-banana|gemini-image|image3/, kind: 'image', style: 'paragraph', maxPromptChars: 3000, rank: 92, identity: true },
  { id: 'gpt-image', match: /gpt-image/, kind: 'image', style: 'paragraph', maxPromptChars: 4000, rank: 90, identity: true },
  { id: 'seedream', match: /seedream/, kind: 'image', style: 'paragraph', maxPromptChars: 2000, rank: 89, identity: true },
  { id: 'flux', match: /flux/, kind: 'image', style: 'paragraph', maxPromptChars: 2000, rank: 86 },
  { id: 'ideogram', match: /ideogram|recraft/, kind: 'image', style: 'paragraph', maxPromptChars: 2000, rank: 84 },
  { id: 'grok-image', match: /grok-imagine-image/, kind: 'image', style: 'concise', maxPromptChars: 1000, rank: 82 },
  { id: 'image', match: /./, kind: 'image', style: 'paragraph', maxPromptChars: 1500, rank: 60 },
];

/** First matching family for the model; the final generic entry always matches. */
export function modelFamily(modelId: string, kind: 'video' | 'image'): ModelFamily {
  const id = modelId.toLowerCase();
  return MODEL_FAMILIES.find(family => family.kind === kind && family.match.test(id))!;
}
