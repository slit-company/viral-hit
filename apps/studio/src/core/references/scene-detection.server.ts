import { constants } from 'node:fs';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { probeMedia } from '../harness/probe-media';
import { fileHash } from '../harness/media-files';
import { projectMediaPin } from '../harness/project-media-input-schema';
import { RejectedSubmission, fingerprint, type Adapter, type Json } from '../harness/durable';
import { getProjectAssetById } from '../workspace-lib/assets/user-assets';
import { inspectProjectReference } from './project-video.server';
import { runSceneProcess } from './scene-process.server';
import { chooseSceneRanges, sceneAnalysis, sceneInput, sceneReceipt, SCENE_MAX_BYTES, SCENE_MAX_SECONDS } from './scene-contract';

export async function sceneEngineIdentity(signal: AbortSignal) {
  const tools = [process.env.VIRAL_HIT_FFMPEG || 'ffmpeg', process.env.VIRAL_HIT_FFPROBE || 'ffprobe'];
  const versions = [];
  for (const tool of tools) {
    const stdout = await runSceneProcess(tool, ['-version'], signal, 5000, 65536);
    versions.push(stdout);
  }
  return createHash('sha256').update(JSON.stringify(['ffmpeg-scdet-v1', tools, versions])).digest('hex');
}
export function parseSceneScores(text: string) {
  const candidates: { time: number; score: number }[] = [];
  let score: number | undefined;
  for (const line of text.split('\n')) {
    if (line.startsWith('frame:')) score = undefined;
    if (line.startsWith('lavfi.scd.score=')) score = Number(line.slice('lavfi.scd.score='.length));
    if (line.startsWith('lavfi.scd.time=')) {
      const time = Number(line.slice('lavfi.scd.time='.length));
      if (!Number.isFinite(time) || time < 0 || score === undefined || !Number.isFinite(score) || score < 0 || score > 100) throw Error('Invalid scene detector output');
      candidates.push({ time: Math.round(time * 1000) / 1000, score });
    }
  }
  if (candidates.length > 4800) throw Error('Scene detector exceeded its frame budget');
  return candidates;
}
async function pinned(projectId: string, raw: unknown, signal: AbortSignal) {
  const input = sceneInput.parse(raw), pin = projectMediaPin.parse(input.pin);
  if (pin.assetId !== input.assetId || pin.projectId !== projectId || pin.kind !== 'video' || pin.sizeBytes > SCENE_MAX_BYTES) throw Error('Scene analysis requires a pinned video of at most 64 MiB');
  const original = await inspectProjectReference(projectId, pin.assetId, signal, pin);
  return { input, pin, file: original.file };
}
export async function detectProjectScenes(projectId: string, raw: unknown, signal: AbortSignal) {
  const { input, pin, file } = await pinned(projectId, raw, signal);
  if (!input.engine || input.engine !== await sceneEngineIdentity(signal)) throw Error('Original scene-analysis tools changed; restore them to resume this job');
  const directory = await mkdtemp(join(tmpdir(), 'vh-scenes-'));
  try {
    const source = join(directory, 'source.bin');
    await copyFile(file, source, constants.COPYFILE_EXCL);
    if (await fileHash(source, signal) !== pin.sha256) throw Error('Scene source changed while copying');
    const media = await probeMedia(source, 'video', signal), duration = media.durationMs! / 1000;
    if (duration > SCENE_MAX_SECONDS || (media.width ?? 0) * (media.height ?? 0) > 16_777_216) throw Error('Scene analysis supports at most ten minutes and 16 megapixels');
    const stdout = await runSceneProcess(process.env.VIRAL_HIT_FFMPEG || 'ffmpeg', [
      '-nostdin', '-v', 'error', '-max_alloc', '67108864', '-threads', '1', '-filter_threads', '1',
      '-protocol_whitelist', 'file', '-format_whitelist', 'mov,matroska', '-i', source,
      '-map', '0:v:0', '-an', '-sn', '-dn', '-t', String(duration),
      '-vf', `scale=w='min(320,iw)':h='min(320,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,format=yuv420p,fps=fps=8:start_time=0,scdet=threshold=${input.threshold}:sc_pass=1,metadata=mode=print:file=-`,
      '-f', 'null', '-',
    ], signal, 180000, 1024 * 1024);
    const candidates = parseSceneScores(stdout).filter(item => item.time > 0 && item.time < duration);
    const analysis = sceneAnalysis.parse({ algorithm: 'ffmpeg-scdet-v1', sampleFps: 8, threshold: input.threshold, minDuration: input.minDuration, maxScenes: input.maxScenes,
      duration, candidateCount: candidates.length, scenes: chooseSceneRanges(candidates, duration, input.minDuration, input.maxScenes) });
    await inspectProjectReference(projectId, pin.assetId, signal, pin);
    const asset = (await getProjectAssetById({ projectId, assetId: pin.assetId }))!;
    return sceneReceipt.parse({ ...pin, publicUrl: asset.publicUrl, width: media.width, height: media.height, durationMs: media.durationMs, mediaMaterialized: true, analysis });
  } finally { await rm(directory, { recursive: true, force: true }); }
}
function inputDigest(raw: unknown) { return fingerprint(sceneInput.parse(raw) as unknown as Json); }
export function createSceneAdapter(): Adapter {
  return {
    recovery: 'replay', execution: { timeoutMs: 240000, abortOnCancel: true },
    async submit(raw, context) {
      if (!context.projectId) throw new RejectedSubmission('Scene analysis requires a project');
      const receipt = await detectProjectScenes(context.projectId, raw, context.signal);
      return { id: JSON.stringify({ inputDigest: inputDigest(raw), receipt }) };
    },
    async poll(id, raw, signal, context) {
      if (!context?.projectId) throw Error('Scene analysis requires a project');
      const saved = JSON.parse(id);
      if (saved.inputDigest !== inputDigest(raw)) throw Error('Scene analysis receipt does not match its request');
      const receipt = sceneReceipt.parse(saved.receipt), { pin } = await pinned(context.projectId, raw, signal);
      if (receipt.projectId !== pin.projectId || receipt.assetId !== pin.assetId || receipt.sha256 !== pin.sha256 || receipt.sizeBytes !== pin.sizeBytes) throw Error('Scene analysis identity mismatch');
      return { state: 'succeeded', output: { ...receipt, tracks: [{ id: 'detected-scenes', kind: 'video', name: 'Detected visual cuts',
        clips: receipt.analysis.scenes.map((scene, index) => ({ id: 'scene-' + (index + 1), type: 'media', source: 'source', startTime: scene.start,
          duration: scene.end - scene.start, inPoint: scene.start, volume: 1, muted: false, fadeIn: 0, fadeOut: 0 })),
      }] } };
    },
    async cancel() { return { state: 'canceled' }; },
  };
}
