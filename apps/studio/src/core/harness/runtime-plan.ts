import { pinProjectInputs } from './comfy-upload';
import { pinExternalAdapters } from './external-catalog';
import type { Plan } from './durable';
export async function pinRuntimePlan(plan: Plan) { return pinExternalAdapters(await pinProjectInputs(plan)); }
