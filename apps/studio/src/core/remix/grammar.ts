import type { RemixAssignment, RemixGrammar, RemixMaterial } from './contract';

const round = (value: number) => Math.round(value * 1000) / 1000;
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

