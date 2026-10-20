import { z } from 'zod';

/**
 * A character is a reusable identity: reference images plus the written
 * invariants every generation must keep. It is workspace-level so the same
 * person, mascot or product appears consistently across projects.
 */
export const MAX_CHARACTER_REFERENCES = 20;
export const MAX_REFERENCE_BYTES = 20 * 1024 * 1024;
export const characterId = z.string().regex(/^[a-z][a-z0-9-]{1,63}$/, 'Use lowercase letters, numbers and hyphens');
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const line = z.string().trim().min(1).max(200);
export const characterKinds = ['person', 'illustrated', 'mascot', 'product', 'other'] as const;
export const referenceRoles = ['canonical', 'angle', 'expression', 'outfit', 'detail'] as const;

export const providerIdentitySchema = z.object({
  /** Provider family, for example "higgsfield-soul"; generation adapters decide whether they can use it. */
  provider: z.string().regex(/^[a-z][a-z0-9-]{1,40}$/),
  referenceId: z.string().trim().min(1).max(200),
  label: z.string().trim().max(80).optional(),
}).strict();

const voiceSchema = z.object({ direction: z.string().trim().min(1).max(500), provider: z.string().max(40).optional(), voiceId: z.string().max(120).optional() }).strict();
const profileFields = {
  name: z.string().trim().min(1).max(80),
  kind: z.enum(characterKinds),
  description: z.string().trim().min(1).max(2000),
  /** Traits every image and video must keep, such as silhouette, colors, clothing and proportions. */
  invariants: z.array(line).max(24),
  /** Changes that are never acceptable, such as extra limbs, different eye count or a logo change. */
  forbidden: z.array(line).max(24),
  providerIdentities: z.array(providerIdentitySchema).max(8),
};

export const characterProfileSchema = z.object({
  ...profileFields,
  invariants: profileFields.invariants.default([]),
  forbidden: profileFields.forbidden.default([]),
  voice: voiceSchema.optional(),
  providerIdentities: profileFields.providerIdentities.default([]),
}).strict();
export type CharacterProfile = z.infer<typeof characterProfileSchema>;

/** An update names only the fields it changes; nothing is defaulted, and voice null removes the voice note. */
export const characterProfilePatchSchema = z.object({ ...profileFields, voice: voiceSchema.nullable() }).partial().strict();

export const characterReferenceSchema = z.object({
  sha256, role: z.enum(referenceRoles), filename: z.string().min(1).max(160),
  mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']), width: z.number().int().positive(), height: z.number().int().positive(),
  note: z.string().trim().max(200).optional(),
}).strict();
export type CharacterReference = z.infer<typeof characterReferenceSchema>;

export const characterSchema = characterProfileSchema.extend({
  id: characterId, version: z.number().int().positive(), status: z.enum(['active', 'archived']),
  references: z.array(characterReferenceSchema).min(1).max(MAX_CHARACTER_REFERENCES),
  createdAt: z.string(), updatedAt: z.string(),
}).strict().superRefine((value, ctx) => {
  if (value.references.filter(item => item.role === 'canonical').length !== 1) ctx.addIssue({ code: 'custom', message: 'A character needs exactly one canonical reference' });
  if (new Set(value.references.map(item => item.sha256)).size !== value.references.length) ctx.addIssue({ code: 'custom', message: 'Duplicate reference image' });
});
export type Character = z.infer<typeof characterSchema>;

/** A reference to add: an existing project image, or an absolute local file for MCP and CLI hosts. */
export const referenceSourceSchema = z.union([
  z.object({ projectId: z.string().min(1).max(160), assetId: z.string().min(1).max(160), role: z.enum(referenceRoles), note: z.string().trim().max(200).optional() }).strict(),
  z.object({ path: z.string().min(1).max(4096), role: z.enum(referenceRoles), note: z.string().trim().max(200).optional() }).strict(),
]);
export type ReferenceSource = z.infer<typeof referenceSourceSchema>;

export const characterRequest = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list'), includeArchived: z.boolean().optional() }).strict(),
  z.object({ action: z.literal('get'), id: characterId }).strict(),
  z.object({ action: z.literal('create'), id: characterId.optional(), profile: characterProfileSchema, references: z.array(referenceSourceSchema).max(MAX_CHARACTER_REFERENCES).default([]) }).strict(),
  z.object({ action: z.literal('update'), id: characterId, expectedVersion: z.number().int().positive(), profile: characterProfilePatchSchema }).strict(),
  z.object({ action: z.literal('add_references'), id: characterId, expectedVersion: z.number().int().positive(), references: z.array(referenceSourceSchema).max(MAX_CHARACTER_REFERENCES).default([]) }).strict(),
  z.object({ action: z.literal('remove_reference'), id: characterId, expectedVersion: z.number().int().positive(), sha256 }).strict(),
  z.object({ action: z.literal('set_canonical'), id: characterId, expectedVersion: z.number().int().positive(), sha256 }).strict(),
  z.object({ action: z.literal('archive'), id: characterId, expectedVersion: z.number().int().positive() }).strict(),
  z.object({ action: z.literal('use'), id: characterId, projectId: z.string().min(1).max(160) }).strict(),
  /** MCP and CLI hosts only: writes a character file to a new absolute path. Browsers download it instead. */
  z.object({ action: z.literal('export'), id: characterId, path: z.string().min(1).max(4096) }).strict(),
  /** MCP and CLI hosts read an absolute path; browsers upload the file and send no path. */
  z.object({ action: z.literal('import'), path: z.string().min(1).max(4096).optional() }).strict(),
]);
export type CharacterRequest = z.infer<typeof characterRequest>;

/**
 * Written identity contract appended to prompts. Images carry the look; this
 * text names what must stay fixed and what must never change.
 */
export function characterBrief(character: Pick<Character, 'name' | 'kind' | 'description' | 'invariants' | 'forbidden'>) {
  const description = character.description.trim();
  const parts = [`${character.name} (${character.kind}): ${description}${/[.!?。]$/.test(description) ? '' : '.'}`];
  if (character.invariants.length) parts.push('Keep exactly: ' + character.invariants.join('; ') + '.');
  if (character.forbidden.length) parts.push('Never: ' + character.forbidden.join('; ') + '.');
  return parts.join(' ');
}

export function slugCharacterId(name: string) {
  const slug = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/^[^a-z]+/, '').slice(0, 48).replace(/-+$/, '');
  return slug.length >= 2 ? slug : 'character';
}

/**
 * A character file moves one character between installations: a strict tar with manifest.json and
 * media/<sha256> for every reference image. Importing always adds a character and never overwrites one.
 */
export const CHARACTER_FILE_KIND = 'viral-hit-character';
export const MAX_CHARACTER_FILE_BYTES = MAX_CHARACTER_REFERENCES * MAX_REFERENCE_BYTES + 1024 * 1024;
export const characterFileManifestSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal(CHARACTER_FILE_KIND),
  id: characterId,
  profile: characterProfileSchema,
  references: z.array(characterReferenceSchema).min(1).max(MAX_CHARACTER_REFERENCES),
}).strict().superRefine((value, ctx) => {
  if (value.references.filter(item => item.role === 'canonical').length !== 1) ctx.addIssue({ code: 'custom', message: 'A character needs exactly one canonical reference' });
  if (new Set(value.references.map(item => item.sha256)).size !== value.references.length) ctx.addIssue({ code: 'custom', message: 'Duplicate reference image' });
});
export type CharacterFileManifest = z.infer<typeof characterFileManifestSchema>;
