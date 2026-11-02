import type { ShotRunView } from './contract';

export type SequencePosition = { position: number; shotId: string; attempts: ShotRunView[] };
export type ShotSequenceView = { sequenceId: string; positions: SequencePosition[]; updatedAt: number };

/** Runs grouped into sequences (newest activity first), positions in order, attempts newest first. */
export function groupShotSequences(shots: readonly ShotRunView[]): ShotSequenceView[] {
  const sequences = new Map<string, Map<number, SequencePosition>>();
  for (const shot of shots) {
    const positions = sequences.get(shot.sequenceId) ?? new Map<number, SequencePosition>();
    const slot = positions.get(shot.position) ?? { position: shot.position, shotId: shot.shotId, attempts: [] };
    slot.attempts.push(shot);
    positions.set(shot.position, slot);
    sequences.set(shot.sequenceId, positions);
  }
  return [...sequences.entries()]
    .map(([sequenceId, positions]) => {
      const ordered = [...positions.values()].sort((left, right) => left.position - right.position);
      for (const slot of ordered) slot.attempts.sort((left, right) => right.createdAt - left.createdAt);
      return { sequenceId, positions: ordered, updatedAt: Math.max(...ordered.flatMap((slot) => slot.attempts.map((attempt) => attempt.createdAt))) };
    })
    .sort((left, right) => right.updatedAt - left.updatedAt);
}

/** Finished takes for one position, newest attempt first: the candidates for the cut. */
export const readyTakes = (slot: SequencePosition) =>
  slot.attempts.flatMap((attempt) => attempt.takes.filter((take) => take.assetId).map((take) => ({ attempt, take })));
