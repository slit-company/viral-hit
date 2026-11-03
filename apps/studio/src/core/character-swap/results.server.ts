import { createHash } from 'node:crypto';
import { persistExternalCommandWithConflictRetry } from '../commands/conflict-retry';
import { createCommandId, type ViralHitCommandOrigin } from '../commands/contracts';
import type { EditorOperation } from '../commands/editor-commands';
import { loadProjectTimeline } from '../editor/timeline-state';
import { findTimelineClip } from '../editor/timeline-document';
import { openSwapRecords } from './records.server';
import { checkFaceMatch } from '../characters/face-match.server';
import { extractProjectVideoFrame } from '../projects/extract-project-video-frame';
import { extractProjectSoundtrack } from '../remix/soundtrack.server';
import { getProjectAssetById } from '../workspace-lib/assets/user-assets';
import { swapVerdict, type CharacterSwapView, type SwapEvaluation } from './contract';

const noFace = (error: unknown) => error instanceof Error && /No face was found in the reference/.test(error.message);
/** How much a result's faces resemble the references, or null when the references show no face. */
export async function faceSimilarity(projectId: string, assetId: string, against: { characterId: string } | { referenceAssetIds: string[] }) {
  try { return (await checkFaceMatch(projectId, { assetIds: [assetId], ...against })).results[0] ?? null; }
  catch (error) { if (noFace(error)) return null; throw error; }
}

/**
 * Local and free. Each result is compared with the character and with the person in the middle frame
 * of its piece: a swap should match the first and not the second.
 */
export async function evaluateSwap(projectId: string, swap: CharacterSwapView): Promise<CharacterSwapView> {
  const evaluations: (SwapEvaluation | null)[] = [];
  for (const piece of swap.pieces) {
    if (!piece.outputAssetId) { evaluations.push(piece.evaluation); continue; }
    const character = await faceSimilarity(projectId, piece.outputAssetId, swap.characterId ? { characterId: swap.characterId } : { referenceAssetIds: swap.imageAssetIds });
    const frame = await extractProjectVideoFrame({ projectId, assetId: piece.sourceAssetId, position: piece.duration / 2,
      derivedAssetId: 'swapface-' + createHash('sha256').update(projectId + '\0' + piece.sourceAssetId).digest('hex').slice(0, 32) });
    const source = await faceSimilarity(projectId, piece.outputAssetId, { referenceAssetIds: [frame.id] });
    evaluations.push({ verdict: swapVerdict(character?.similarity ?? null, source?.similarity ?? null), character: character?.similarity ?? null, source: source?.similarity ?? null, facedFrames: character?.facedFrames ?? 0 });
  }
  const h = openSwapRecords();
  try { h.db.prepare('UPDATE vh_character_swaps SET evaluations_json=? WHERE request_id=? AND project_id=?').run(JSON.stringify(evaluations), swap.requestId, projectId); }
  finally { h.close(); }
  return { ...swap, pieces: swap.pieces.map((piece, index) => ({ ...piece, evaluation: evaluations[index] })) };
}

/**
 * Results become takes of the clip, split where pieces meet, so the original is one click away.
 * With keepSound the clip's own sound goes on an audio track and the swapped picture is muted.
 */
export async function placeSwap(projectId: string, swap: CharacterSwapView, origin: ViralHitCommandOrigin) {
  if (swap.pieces.some(piece => !piece.outputAssetId)) throw Error('Wait until every piece has finished');
  const timeline = await loadProjectTimeline(projectId);
  const clip = timeline && findTimelineClip(timeline.document, swap.clipId);
  if (!clip || clip.sourceType !== 'video') throw Error('The clip is no longer on the timeline');
  const outputs = await Promise.all(swap.pieces.map(piece => getProjectAssetById({ projectId, assetId: piece.outputAssetId! })));
  const tag = swap.requestId.slice(0, 8), operations: EditorOperation[] = [];
  const ids = swap.pieces.map((_, index) => index === 0 ? clip.id : clip.id + '-swap-' + tag + '-' + (index + 1));
  for (let index = 1; index < swap.pieces.length; index++) operations.push({ type: 'split_clip', clipId: ids[index - 1], sourceTime: swap.pieces[index].start, rightClipId: ids[index] });
  swap.pieces.forEach((piece, index) => {
    const asset = outputs[index];
    if (!asset) throw Error('A swapped piece is missing from the project');
    const takeId = 'swap-' + tag + '-' + (index + 1);
    operations.push({ type: 'add_take', clipId: ids[index], take: { id: takeId, assetId: asset.id, sourceUrl: asset.publicUrl, name: 'Character swap ' + (index + 1), sourceType: 'video',
      sourceDuration: (asset.durationMs ?? 0) / 1000, sourceGenerationId: null, prompt: swap.prompt } }, { type: 'activate_take', clipId: ids[index], takeId });
  });
  let keptSound = false;
  if (swap.keepSound && (clip.speed ?? 1) === 1 && !clip.muted) {
    const soundtrack = await extractProjectSoundtrack({ projectId, assetId: clip.assetId, signal: AbortSignal.timeout(120_000) }).catch(() => null);
    if (soundtrack) {
      const soundId = clip.id + '-sound-' + tag;
      operations.push({ type: 'add_clip', clipId: soundId, assetId: soundtrack.assetId, sourceUrl: '', name: clip.name + ' (original sound)', sourceType: 'audio', sourceDuration: soundtrack.duration, startTime: clip.startTime, audioRole: 'source' },
        { type: 'trim_clip', clipId: soundId, inPoint: clip.inPoint, outPoint: clip.outPoint }, ...ids.map(id => ({ type: 'update_audio' as const, clipId: id, patch: { muted: true } })));
      keptSound = true;
    }
  }
  const commandId = createCommandId();
  const result = await persistExternalCommandWithConflictRetry({ input: { projectId, origin, commandId, idempotencyKey: 'character-swap:' + swap.requestId, expectedRevision: timeline!.version, command: { type: 'editor.apply', operations } } });
  if (!result.ok) throw Error(result.message);
  const h = openSwapRecords();
  try { h.db.prepare('UPDATE vh_character_swaps SET placed_at=? WHERE request_id=? AND project_id=?').run(Date.now(), swap.requestId, projectId); }
  finally { h.close(); }
  return { revision: result.revision, clips: ids, keptSound };
}
