import { z } from 'zod';
import { storyboardPlan, storyboardShot, storyboardId, storyboardRequest, type StoryboardPlan, type StoryboardRequest } from '@/core/storyboards/contract';

export type BoardDraft = { id: string; revision: number; plan: StoryboardPlan };
export type PendingShotAction = Extract<StoryboardRequest, { action: 'generate' | 'assemble' }>;
export function newShot() {
  return { id: 'shot-' + crypto.randomUUID().slice(0, 8), title: 'Untitled shot', duration: 3, direction: '', references: [], preserve: [], change: [], avoid: [], caption: '' };
}
export function newDraft(): BoardDraft {
  return { id: 'board-' + crypto.randomUUID().slice(0, 8), revision: 0,
    plan: { schemaVersion: 1, title: 'Untitled storyboard', scope: 'general', intent: '', references: [], shots: [newShot()], audio: [] } };
}
const draftPlan = z.object({ ...storyboardPlan.shape,
  title: z.string().max(120), intent: z.string().max(4000),
  references: z.array(z.object({ ...storyboardPlan.shape.references.unwrap().element.shape, observation: z.string().max(4000) }).strict()).max(32),
  shots: z.array(storyboardShot.safeExtend({ title: z.string().max(120), direction: z.string().max(4000),
    preserve: z.array(z.string().max(4000)).max(20), change: z.array(z.string().max(4000)).max(20), avoid: z.array(z.string().max(4000)).max(20),
  })).min(1).max(16),
}).strict();
export function readDraft(raw: string): BoardDraft {
  return z.object({ id: storyboardId, revision: z.number().int().min(0), plan: draftPlan }).strict().parse(JSON.parse(raw));
}
export function planToSave(plan: StoryboardPlan): StoryboardPlan {
  return { ...plan, shots: plan.shots.map(shot => ({ ...shot,
    preserve: shot.preserve.filter(line => line.trim()), change: shot.change.filter(line => line.trim()), avoid: shot.avoid.filter(line => line.trim()),
  })) };
}
export function readPending(raw: string): PendingShotAction {
  const value = storyboardRequest.parse(JSON.parse(raw));
  if (value.action !== 'generate' && value.action !== 'assemble') throw Error('Invalid pending request');
  return value;
}
export function downloadDraft(draft: BoardDraft) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(draft, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url; link.download = draft.id + '.storyboard-draft.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
