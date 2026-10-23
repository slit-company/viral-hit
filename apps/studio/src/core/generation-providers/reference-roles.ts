import { z } from 'zod';

/**
 * Roles a model must declare before callers may use them. reference, source and audio_track are
 * understood by every model; mask has its own maskInput contract.
 */
export const SPECIFIC_REFERENCE_ROLES = ['style', 'subject', 'pose'] as const;
export type SpecificReferenceRole = typeof SPECIFIC_REFERENCE_ROLES[number];
export const referenceRolesSchema = z.array(z.enum(SPECIFIC_REFERENCE_ROLES)).min(1).max(SPECIFIC_REFERENCE_ROLES.length)
  .refine(roles => new Set(roles).size === roles.length, 'Reference roles must be unique');
export type ReferenceRoles = z.infer<typeof referenceRolesSchema>;

const specific = new Set<string>(SPECIFIC_REFERENCE_ROLES);

/** Shared admission rule, checked before any intent or upload so a role is never silently dropped. */
export function validateReferenceRoles(references: readonly { role: string }[], declared: readonly string[] | undefined, modelName: string) {
  for (const { role } of references) {
    if (specific.has(role) && !declared?.includes(role)) throw Error(modelName + ' does not use ' + role + ' references. Use reference, or choose a model that declares the ' + role + ' role.');
  }
}

/** Provider input: one entry per delivered reference URL, in request order. */
export const referenceRoleEntries = z.array(z.object({ url: z.string().url().max(4096), role: z.string().min(1).max(40) }).strict()).max(20);

/** Every role entry must name a URL that is actually delivered in the same input. */
export function checkReferenceRoleEntries(value: unknown, deliveredUrls: readonly string[]) {
  if (value === undefined) return;
  const entries = referenceRoleEntries.parse(value), delivered = new Set(deliveredUrls);
  if (entries.some(entry => !delivered.has(entry.url))) throw Error('Reference roles must describe delivered references');
}

