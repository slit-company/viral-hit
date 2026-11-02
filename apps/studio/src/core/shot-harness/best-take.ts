import type { FaceMatchStatus } from '../characters/face-match';

export type TakeChoice = { assetId: string; score: number; face: FaceMatchStatus | null };

/**
 * The best take has the highest quality score among takes whose face check does not show someone else.
 * When every take shows a different face, or no take was checked, quality alone decides.
 */
export function pickBestTake(takes: readonly TakeChoice[]): TakeChoice | null {
  const kept = takes.filter(take => take.face !== 'different');
  return (kept.length ? kept : takes).reduce<TakeChoice | null>((best, take) => !best || take.score > best.score ? take : best, null);
}
