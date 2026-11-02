/**
 * Face match compares the faces in project images or video frames with reference faces. The score is
 * OpenCV SFace cosine similarity; 0.363 is OpenCV's published same-person threshold, measured on LFW.
 * Pose, light and motion blur lower scores, so a score near the threshold is uncertain, not a verdict.
 */
export const FACE_MATCH_THRESHOLD = 0.363;

export type FaceMatchStatus = 'match' | 'mixed' | 'different' | 'no-face';
export type FaceMatchFrame = { time: number | null; faces: number; similarity: number | null };
export type FaceMatchResult = {
  assetId: string;
  kind: 'image' | 'video';
  status: FaceMatchStatus;
  /** Median best similarity over frames that show a face. */
  similarity: number | null;
  matchedFrames: number;
  facedFrames: number;
  lowest: { time: number | null; similarity: number } | null;
  frames: FaceMatchFrame[];
};
export type FaceMatchReport = { engine: 'opencv-sface'; threshold: number; referenceImages: number; referenceFaces: number; results: FaceMatchResult[] };

const round = (value: number) => Math.round(value * 1000) / 1000;

/** Reduces per-frame best similarities to one status: most frames above the threshold is a match. */
export function summarizeFaceFrames(frames: readonly FaceMatchFrame[], threshold = FACE_MATCH_THRESHOLD) {
  const scored = frames.filter((frame): frame is FaceMatchFrame & { similarity: number } => frame.similarity !== null);
  if (!scored.length) return { status: 'no-face' as const, similarity: null, matchedFrames: 0, facedFrames: 0, lowest: null };
  const values = scored.map(frame => frame.similarity).sort((left, right) => left - right), middle = values.length >> 1;
  const similarity = round(values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2);
  const matchedFrames = scored.filter(frame => frame.similarity >= threshold).length;
  const low = scored.reduce((worst, frame) => frame.similarity < worst.similarity ? frame : worst);
  const status: FaceMatchStatus = !matchedFrames ? 'different'
    : matchedFrames === scored.length || (similarity >= threshold && matchedFrames / scored.length >= .75) ? 'match' : 'mixed';
  return { status, similarity, matchedFrames, facedFrames: scored.length, lowest: { time: low.time, similarity: round(low.similarity) } };
}

/** Evenly spaced sample times inside a video, avoiding the first and last frame. */
export function faceSampleTimes(durationSec: number, maxFrames = 8) {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return [0];
  const count = Math.max(1, Math.min(maxFrames, Math.ceil(durationSec)));
  return Array.from({ length: count }, (_, index) => round(((index + .5) * durationSec) / count));
}
