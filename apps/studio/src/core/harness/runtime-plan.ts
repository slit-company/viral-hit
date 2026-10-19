import { pinSequenceInputs } from './sequence-adapter';
import { pinReferencePlan } from '../references/recipe-plan.server';
import { pinExternalMediaInputs } from './external-media-inputs';
import { pinProjectInputs } from './comfy-upload';
import { pinExternalAdapters } from './external-catalog';
import type { Plan } from './durable';
export async function pinRuntimePlan(plan: Plan) { return pinSequenceInputs(await pinExternalMediaInputs(pinExternalAdapters(await pinReferencePlan(await pinProjectInputs(plan))))); }
