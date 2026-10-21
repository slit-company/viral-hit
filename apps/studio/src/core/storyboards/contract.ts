import { z } from 'zod';

export const MAX_STORYBOARD_BYTES = 256_000;
export const storyboardId = z.string().regex(/^[a-z][a-z0-9-]{0,39}$/).refine(value => !['constructor', 'prototype'].includes(value));
const assetId = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const revision = z.number().int().min(0);
const time = z.number().finite().min(0).max(3600);
const duration = z.number().finite().min(0.01).max(3600);
const text = z.string().trim().min(1).max(4000);
const decisions = z.array(text).max(20).default([]);
const reference = z.object({
  id: storyboardId, assetId, sha256: hash, observation: text,
  basis: z.enum(['observed', 'inferred', 'proposed']),
  startTime: time.optional(), endTime: time.optional(),
}).strict().refine(value => value.endTime === undefined || (value.startTime !== undefined && value.endTime > value.startTime), 'Reference time range is invalid');
export const storyboardShot = z.object({
  id: storyboardId, title: z.string().trim().min(1).max(120), duration,
  direction: text, references: z.array(storyboardId).max(32).default([]),
  preserve: decisions, change: decisions, avoid: decisions,
  caption: z.string().max(4000).default(''),
  recipe: z.object({
    id: z.string().regex(/^[a-z][a-z0-9-]{0,79}$/), digest: hash,
    values: z.record(z.string(), z.json()), outputNodeId: z.string().trim().min(1).max(100),
  }).strict().optional(),
}).strict();
export const storyboardPlan = z.object({
  schemaVersion: z.literal(1), title: z.string().trim().min(1).max(120),
  scope: z.enum(['general', 'specialized']), intent: text,
  references: z.array(reference).max(32).default([]),
  shots: z.array(storyboardShot).min(1).max(16),
  audio: z.array(z.object({
    id: storyboardId, assetId, sha256: hash, startTime: time, duration, inPoint: time.default(0),
    role: z.enum(['music', 'voice', 'sfx', 'source']), volume: z.number().min(0).max(4).default(1),
  }).strict()).max(8).default([]),
}).strict().superRefine((plan, ctx) => {
  for (const values of [plan.references, plan.shots, plan.audio]) {
    if (new Set(values.map(item => item.id)).size !== values.length) ctx.addIssue({ code: 'custom', message: 'Duplicate storyboard ID' });
  }
  const refs = new Set(plan.references.map(item => item.id));
  for (const shot of plan.shots) {
    if (new Set(shot.references).size !== shot.references.length || shot.references.some(id => !refs.has(id))) ctx.addIssue({ code: 'custom', message: 'Shot references must identify distinct declared observations' });
  }
  if (plan.shots.reduce((total, shot) => total + shot.duration, 0) > 3600 || plan.audio.some(item => item.startTime + item.duration > 3600)) ctx.addIssue({ code: 'custom', message: 'Storyboard exceeds one hour' });
});
export type StoryboardPlan = z.infer<typeof storyboardPlan>;
export type StoryboardShot = z.infer<typeof storyboardShot>;
export type AcceptedShot = {
  shotDigest: string; assetId: string; sha256: string; kind: 'image' | 'video';
  inPoint: number; notes: string; acceptedAt: string; sourceActionId?: string;
};
export type StoryboardState = { projectId: string; id: string; revision: number; plan: StoryboardPlan; accepted: Record<string, AcceptedShot> };
export const storyboardRequest = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list') }).strict(),
  z.object({ action: z.literal('read'), id: storyboardId, revision: revision.optional() }).strict(),
  z.object({ action: z.literal('save'), id: storyboardId, expectedRevision: revision, plan: storyboardPlan }).strict(),
  z.object({ action: z.literal('generate'), id: storyboardId, expectedRevision: revision, shotId: storyboardId, requestId: z.string().uuid() }).strict(),
  z.object({ action: z.literal('assemble'), id: storyboardId, expectedRevision: revision, requestId: z.string().uuid() }).strict(),
  z.object({ action: z.literal('resume'), id: storyboardId, requestId: z.string().uuid() }).strict(),
  z.object({ action: z.literal('accept'), id: storyboardId, expectedRevision: revision, shotId: storyboardId,
    source: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('asset'), assetId, sha256: hash }).strict(),
      z.object({ kind: z.literal('generation'), requestId: z.string().uuid() }).strict(),
    ]), inPoint: time.default(0), notes: text,
  }).strict(),
]);
export type StoryboardRequest = z.infer<typeof storyboardRequest>;
