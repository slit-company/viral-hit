import type { PreflightIssue } from './comfy-preflight';
export type ModelRequirement = {
  step: string; modelId: string; kind: string; providerId?: string;
  status: 'available' | 'missing' | 'unconfigured' | 'deferred' | 'incompatible';
};
export type ModelRequirements = {
  status: 'checked' | 'issues' | 'not-applicable'; models: ModelRequirement[];
  issues: PreflightIssue[]; limits: string;
};
