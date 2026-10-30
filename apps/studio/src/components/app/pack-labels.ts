import { m as uiMessages } from '@/paraglide/messages.js';
import type { PackScope } from '@/core/harness/recipe-packs';

export const packScopeLabel: Record<PackScope, string> = { get general() { return uiMessages["ui.creative-packs.general"](); }, get specialized() { return uiMessages["ui.app.for_a_specific_job"](); } };
