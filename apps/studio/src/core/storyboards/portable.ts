import { z } from 'zod';
import { storyboardId, storyboardPlan, type StoryboardState } from './contract';
import { recipeSchema, type Recipe } from '../harness/recipes';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const accepted = z.object({
  shotDigest: hash, assetId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/), sha256: hash,
  kind: z.enum(['image', 'video']), inPoint: z.number().finite().min(0).max(3600),
  notes: z.string().trim().min(1).max(4000), acceptedAt: z.string().datetime(),
}).strict();
export const portableStoryboard = z.object({
  id: storyboardId, sourceRevision: z.number().int().positive(), plan: storyboardPlan,
  accepted: z.record(storyboardId, accepted),
}).strict();
export const storyboardAttachment = z.object({
  boards: z.array(portableStoryboard).max(64), recipes: z.array(recipeSchema).max(1024),
}).strict().superRefine((value, ctx) => {
  if (new Set(value.boards.map(board => board.id)).size !== value.boards.length) ctx.addIssue({ code: 'custom', message: 'Duplicate storyboard identity' });
});
export type StoryboardAttachment = z.infer<typeof storyboardAttachment>;
export type PortableStoryboard = z.infer<typeof portableStoryboard>;
export type PortableMedia = { id: string; kind: string; sha256: string; sizeBytes: number; durationMs: number | null };

/** Only declared asset inputs are rewritten; prompt text and arbitrary scalar values stay verbatim. */
export function mapStoryboardPlan(plan: StoryboardState['plan'], recipes: Map<string, Recipe>, ids: Map<string, string>) {
  const mappedId = (id: string) => { const mapped = ids.get(id); if (!mapped) throw Error('Storyboard references missing project media: ' + id); return mapped; };
  return storyboardPlan.parse({ ...plan,
    references: plan.references.map(ref => ({ ...ref, assetId: mappedId(ref.assetId) })),
    audio: plan.audio.map(audio => ({ ...audio, assetId: mappedId(audio.assetId) })),
    shots: plan.shots.map(shot => {
      if (!shot.recipe) return shot;
      const definition = recipes.get(shot.recipe.digest);
      if (!definition || definition.id !== shot.recipe.id) throw Error('Storyboard needs its exact recipe definition: ' + shot.recipe.id);
      const values = { ...shot.recipe.values };
      for (const parameter of definition.parameters) if (parameter.type === 'asset') {
        const value = Object.hasOwn(values, parameter.id) ? values[parameter.id] : parameter.default;
        // An authored but incomplete input remains incomplete, never an inferred binding.
        if (value === undefined || value === '') continue;
        if (typeof value !== 'string') throw Error('Invalid storyboard asset parameter: ' + parameter.id);
        values[parameter.id] = mappedId(value);
      }
      return { ...shot, recipe: { ...shot.recipe, values } };
    }),
  });
}

export function validateStoryboardMedia(board: PortableStoryboard, media: Map<string, PortableMedia>, recipes: Map<string, Recipe>) {
  const owned = (id: string, sha256?: string) => {
    const asset = media.get(id);
    if (!asset || (sha256 && asset.sha256 !== sha256)) throw Error('Storyboard media identity mismatch: ' + id);
    return asset;
  };
  const bounded = (id: string, sha256: string) => {
    const asset = owned(id, sha256);
    if (asset.sizeBytes > 256 * 1024 * 1024) throw Error('Storyboard media exceeds 256 MiB');
    return asset;
  };
  const references = new Set<string>(); let referenceBytes = 0;
  for (const item of [...board.plan.references, ...board.plan.audio]) {
    const asset = bounded(item.assetId, item.sha256);
    if (!references.has(asset.id)) { references.add(asset.id); referenceBytes += asset.sizeBytes; }
    if ('observation' in item) {
      if (asset.kind === 'image' && (item.startTime !== undefined || item.endTime !== undefined)) throw Error('Still reference has a time range');
      if (item.endTime !== undefined && item.endTime > (asset.durationMs ?? 0) / 1000) throw Error('Storyboard reference exceeds its media');
    } else if (asset.kind !== 'audio' || item.inPoint + item.duration > (asset.durationMs ?? 0) / 1000) throw Error('Storyboard soundtrack exceeds its audio');
  }
  if (referenceBytes > 512 * 1024 * 1024) throw Error('Storyboard references exceed 512 MiB');
  for (const [id, accepted] of Object.entries(board.accepted)) {
    const shot = board.plan.shots.find(shot => shot.id === id), asset = bounded(accepted.assetId, accepted.sha256);
    if (!shot || asset.kind !== accepted.kind || (asset.kind === 'image' ? accepted.inPoint !== 0 : accepted.inPoint + shot.duration > (asset.durationMs ?? 0) / 1000)) throw Error('Accepted storyboard shot does not fit its media');
  }
  for (const shot of board.plan.shots) if (shot.recipe) {
    const recipe = recipes.get(shot.recipe.digest);
    if (!recipe || recipe.id !== shot.recipe.id) throw Error('Storyboard recipe snapshot is missing');
    for (const parameter of recipe.parameters) if (parameter.type === 'asset') {
      const value = Object.hasOwn(shot.recipe.values, parameter.id) ? shot.recipe.values[parameter.id] : parameter.default;
      if (value === undefined || value === '') continue;
      if (typeof value !== 'string' || owned(value).kind !== parameter.kind) throw Error('Storyboard recipe media kind mismatch');
    }
  }
}
