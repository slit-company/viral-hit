import type { EditorOperation } from '../commands/editor-commands';
import type { TimelineTransition } from '../editor/transition-contract';
import type { RemixAssignment, RemixGrammar, RemixMaterial } from './contract';

const round = (value: number) => Math.round(value * 1000) / 1000;

/** Cut times, pace and shot lengths from a contiguous scene list covering the whole reference. */
export function remixGrammar(scenes: readonly { start: number; end: number }[], duration: number): RemixGrammar {
  const shots = scenes.map((scene, index) => ({ index, start: round(scene.start), end: round(scene.end), duration: round(scene.end - scene.start) }));
  return { duration: round(duration), shots, averageShot: round(duration / Math.max(1, shots.length)), cutsPerMinute: round(((shots.length - 1) / Math.max(duration, 0.001)) * 60) };
}

const FIT_TOLERANCE = 0.05;

/**
 * Material for every shot, cycling through the chosen order. A shot takes the next image, or the next
 * video long enough to fill it; when no video is long enough the longest one plays and the rest of the
 * shot stays black, so the reference's cut times never move.
 */
export function assignRemixMaterials(grammar: RemixGrammar, materials: readonly RemixMaterial[]): RemixAssignment[] {
  if (!materials.length) throw new Error('Choose at least one image or video for the remix.');
  let cursor = 0;
  return grammar.shots.map((shot) => {
    for (let step = 0; step < materials.length; step += 1) {
      const material = materials[(cursor + step) % materials.length];
      // An unknown length (only in a browser preview; the server measures every video) is assumed to fit.
      if (material.kind === 'image' || material.duration === null || material.duration >= shot.duration - FIT_TOLERANCE) {
        cursor = (cursor + step + 1) % materials.length;
        return { shot, material, length: material.kind === 'image' || material.duration === null ? shot.duration : round(Math.min(shot.duration, material.duration)) };
      }
    }
    const longest = [...materials].sort((left, right) => (right.duration ?? 0) - (left.duration ?? 0))[0];
    cursor = (materials.indexOf(longest) + 1) % materials.length;
    return { shot, material: longest, length: round(Math.min(shot.duration, longest.duration ?? shot.duration)) };
  });
}

/** Editor operations that place each shot at the reference's cut time after `offset`, plus the soundtrack. */
export function remixOperations({ assignments, offset, idPrefix, transition, soundtrack }: {
  assignments: readonly RemixAssignment[]; offset: number; idPrefix: string; transition: TimelineTransition | null;
  soundtrack: { assetId: string; duration: number } | null;
}): EditorOperation[] {
  const operations: EditorOperation[] = [];
  assignments.forEach(({ shot, material, length }, index) => {
    const clipId = `${idPrefix}-shot-${index + 1}`;
    const startTime = round(offset + shot.start);
    if (material.kind === 'image') {
      operations.push({ type: 'add_clip', clipId, assetId: material.assetId, sourceUrl: '', name: material.name, sourceType: 'image', sourceDuration: length, startTime });
    } else {
      operations.push({ type: 'add_clip', clipId, assetId: material.assetId, sourceUrl: '', name: material.name, sourceType: 'video', sourceDuration: material.duration!, startTime });
      if (length < material.duration! - 0.001) operations.push({ type: 'trim_clip', clipId, inPoint: 0, outPoint: length });
    }
    if (transition && index > 0) operations.push({ type: 'set_transition', clipId, transition });
  });
  if (soundtrack) operations.push({ type: 'add_clip', clipId: `${idPrefix}-soundtrack`, assetId: soundtrack.assetId, sourceUrl: '', name: 'Reference soundtrack', sourceType: 'audio', sourceDuration: soundtrack.duration, startTime: round(offset), audioRole: 'music' });
  return operations;
}
