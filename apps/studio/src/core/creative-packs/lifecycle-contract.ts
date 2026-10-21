import type { CreativePackManifest, CreativePackSummary } from './contract';
import type { InstalledPack } from '@/core/harness/recipe-packs';

export type CreativeMemberReview = {
  key: string; kind: 'recipe' | 'skill' | 'character'; id: string;
  current: unknown | null; incoming: unknown | null;
  change: 'add' | 'same' | 'different' | 'detach' | 'missing';
  reserved: boolean; blocking: string[];
  otherPacks: { id: string; title: string }[];
};
export type CreativeLifecycleReview = {
  current: CreativePackManifest; revision: string; stateDigest: string;
  members: CreativeMemberReview[];
  recipePack: InstalledPack | null;
};
export type CreativeReleaseHistory = { id: string; currentDigest: string | null; releases: CreativePackSummary[] };
