import type { PackSummary } from './recipe-packs';
import type { Recipe } from './recipes';

export type PackMemberState = {
  id: string;
  current?: Recipe;
  reserved: boolean;
  otherPacks: { id: string; title: string }[];
};
export type PackStateReview = {
  pack: PackSummary & { installedAt: number };
  members: PackMemberState[];
  /** Pins current definitions, absent members, metadata and other memberships. */
  stateDigest: string;
};
export type PackUpdateReview = PackStateReview & {
  incoming: PackSummary;
  changes: (PackMemberState & {
    incoming?: Recipe;
    change: 'add' | 'same' | 'different' | 'detach' | 'missing';
    unavailableOperations: string[];
  })[];
  blocking: string[];
};
