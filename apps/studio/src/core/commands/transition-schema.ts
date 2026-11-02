import { z } from 'zod';
import { timelineTransitionSchema } from '../editor/transition-contract';

const clipId = z.string().trim().min(1).max(160);

/** Set or clear how one base-track visual clip enters; duration is clamped to the clip. */
export const setTransitionSchema = z
  .object({ type: z.literal('set_transition'), clipId, transition: timelineTransitionSchema.nullable() })
  .strict();

/** Apply one transition at every cut between adjacent visuals, or clear all base-track transitions with null. */
export const setTransitionsAtCutsSchema = z
  .object({ type: z.literal('set_transitions_at_cuts'), transition: timelineTransitionSchema.nullable() })
  .strict();
