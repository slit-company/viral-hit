import { z } from 'zod';
import { overlayMotionSchema, overlayTransformSchema } from './overlay-motion';
import { timelineTransitionSchema } from './transition-contract';
import { captionHighlightSchema, captionWordsSchema } from './caption-words';
import { audioDuckingSchema } from './audio-ducking';

export const TIMELINE_SCHEMA_VERSION = 6 as const;

/** Ingestion schema for persisted and imported timeline documents; normalizeTimelineDocument owns migration and cross-field rules. */
const timelineClipSchema = z.object({
  id: z.string().min(1).max(160),
  assetId: z.string().min(1).max(160),
  sourceUrl: z.string().max(4096),
  trackId: z.string().min(1).max(160),
  name: z.string().min(1).max(240),
  sourceType: z.enum(['image', 'video', 'audio', 'caption']),
  startTime: z.number().finite().min(0).max(86_400),
  duration: z.number().finite().positive().max(86_400),
  inPoint: z.number().finite().min(0).max(86_400),
  outPoint: z.number().finite().positive().max(86_400),
  sourceDuration: z.number().finite().positive().max(86_400),
  volume: z.number().finite().min(0).max(4),
  muted: z.boolean(),
  fadeIn: z.number().finite().min(0).max(86_400).default(0),
  fadeOut: z.number().finite().min(0).max(86_400).default(0),
  text: z.string().max(4_000).default(''),
  audioRole: z.enum(['music', 'voice', 'sfx', 'source']).optional(),
  ducking: audioDuckingSchema.optional(),
  overlay: overlayTransformSchema.nullable().default(null),
  motion: overlayMotionSchema.optional(),
  transition: timelineTransitionSchema.optional(),
  words: captionWordsSchema.optional(),
  caption: z
    .object({
      fontScale: z.number().finite().min(0.015).max(0.12),
      maxWidth: z.number().finite().min(0.25).max(0.98),
      bottomOffset: z.number().finite().min(0.02).max(0.9),
    })
    .strict()
    .nullable()
    .default(null),
  takes: z
    .array(
      z.object({
        id: z.string().min(1).max(160),
        assetId: z.string().min(1).max(160),
        sourceUrl: z.string().max(4096),
        name: z.string().min(1).max(240),
        sourceDuration: z.number().finite().positive().max(86_400),
        sourceType: z.enum(['image', 'video', 'audio']).optional(),
        sourceGenerationId: z.string().min(1).max(200).nullable(),
        prompt: z.string().max(20_000),
        createdAt: z.string().min(1).max(80),
      })
    )
    .max(100)
    .default([]),
  activeTakeId: z.string().min(1).max(160).nullable().default(null),
});

const timelineTrackSchema = z.object({
  id: z.string().min(1).max(160),
  kind: z.enum(['video', 'overlay', 'audio', 'caption']),
  name: z.string().min(1).max(120),
  locked: z.boolean(),
  hidden: z.boolean(),
  muted: z.boolean(),
  clips: z.array(timelineClipSchema).max(1_000),
});

export const timelineDocumentSchema = z.object({
  schemaVersion: z.literal(TIMELINE_SCHEMA_VERSION),
  id: z.string().min(1).max(160),
  projectId: z.string().min(1).max(160),
  name: z.string().min(1).max(240),
  createdAt: z.string().min(1).max(80),
  updatedAt: z.string().min(1).max(80),
  duration: z.number().finite().min(0).max(86_400),
  lastRenderAssetId: z.string().min(1).max(160).nullable().default(null),
  lastRenderUrl: z.string().min(1).max(4096).nullable().default(null),
  captionStyle: z
    .enum(['classic', 'bold', 'boxed', 'minimal'])
    .default('classic'),
  captionHighlight: captionHighlightSchema.nullable().optional(),
  tracks: z.array(timelineTrackSchema).min(1).max(64),
});
