import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fingerprint, RejectedSubmission, type Adapter, type Json } from '../harness/durable';
import { fileHash } from '../harness/media-files';
import { probeMedia } from '../harness/probe-media';
import { projectMediaPin } from '../harness/project-media-input-schema';
import { inspectProjectReference } from '../references/project-video.server';
import { runSceneProcess } from '../references/scene-process.server';
import { GRAMMAR_MAX_BYTES, GRAMMAR_MAX_SECONDS, grammarAnalysis, grammarInput, grammarReceipt } from './grammar-contract';
import { estimateMotion, type MotionSample } from './motion';
import { mergeTextBlocks, parseTesseractTsv, trackTextSegments, type TextBlock } from './onscreen-text';

const ffmpeg = () => process.env.VIRAL_HIT_FFMPEG || 'ffmpeg';
const OCR_LANGUAGES = ['eng', 'kor', 'jpn', 'chi_sim', 'chi_tra'];

/** Tesseract and its installed languages, or null. Optional: without it only camera motion is read. */
export async function tesseractEngine(signal: AbortSignal) {
  const binary = process.env.VIRAL_HIT_TESSERACT || 'tesseract';
  try {
    const version = await runSceneProcess(binary, ['--version'], signal, 5000, 65536);
    const installed = (await runSceneProcess(binary, ['--list-langs'], signal, 5000, 65536)).split('\n').map(line => line.trim());
    const languages = OCR_LANGUAGES.filter(language => installed.includes(language));
    return languages.length ? { binary, version: version.split('\n')[0], languages } : null;
  } catch { signal.throwIfAborted(); return null; }
}
/** Pinned with the plan, so a changed tool cannot silently change a durable result. */
export async function grammarEngineIdentity(text: boolean, signal: AbortSignal) {
  const versions = [await runSceneProcess(ffmpeg(), ['-version'], signal, 5000, 65536)];
  const ocr = text ? await tesseractEngine(signal) : null;
  return createHash('sha256').update(JSON.stringify(['viral-hit-grammar-v1', ffmpeg(), versions, ocr])).digest('hex');
}

/** Streams small gray frames from FFmpeg and compares each with the previous one; memory stays at two frames. */
function readMotion(file: string, duration: number, width: number, height: number, signal: AbortSignal) {
  const fps = duration <= 120 ? 8 : duration <= 300 ? 4 : 2;
  const gridWidth = 96, gridHeight = Math.max(24, Math.min(256, 2 * Math.round((96 * height) / width / 2)));
  const frameSize = gridWidth * gridHeight, samples: MotionSample[] = [];
  return new Promise<{ fps: 2 | 4 | 8; width: number; height: number; samples: MotionSample[] }>((resolve, reject) => {
    const child = spawn(ffmpeg(), ['-nostdin', '-v', 'error', '-threads', '1', '-protocol_whitelist', 'file', '-i', file, '-map', '0:v:0', '-an', '-sn', '-dn', '-t', String(duration),
      '-vf', `fps=${fps},scale=${gridWidth}:${gridHeight}:flags=area,format=gray`, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { stdio: ['ignore', 'pipe', 'ignore'] });
    let buffer: Buffer = Buffer.alloc(0), previous: Uint8Array | null = null, failure: Error | null = null;
    const stop = () => { failure ??= new Error('Motion analysis was canceled'); child.kill('SIGKILL'); };
    const deadline = setTimeout(() => { failure = new Error('Motion analysis exceeded its deadline'); child.kill('SIGKILL'); }, 180_000);
    signal.addEventListener('abort', stop, { once: true });
    child.stdout.on('data', (chunk: Buffer) => {
      buffer = buffer.length ? Buffer.concat([buffer, chunk]) : Buffer.from(chunk);
      while (buffer.length >= frameSize && !failure) {
        const frame = new Uint8Array(buffer.subarray(0, frameSize)); buffer = buffer.subarray(frameSize);
        if (previous) samples.push(estimateMotion(previous, frame, gridWidth, gridHeight));
        previous = frame;
        if (samples.length > 2400) { failure = new Error('Motion analysis exceeded its frame budget'); child.kill('SIGKILL'); }
      }
    });
    child.once('error', () => { failure ??= new Error('Motion analysis could not start FFmpeg'); });
    child.once('close', code => {
      clearTimeout(deadline); signal.removeEventListener('abort', stop);
      if (failure || code !== 0) reject(failure ?? new Error('Motion analysis failed; check the reference video'));
      else resolve({ fps, width: gridWidth, height: gridHeight, samples });
    });
  });
}

/**
 * At most 60 sampled frames, read three at a time; each block keeps its position on screen. Every frame is
 * read twice: as is, and with only what is brighter than its surroundings kept (frame minus a blurred copy,
 * thresholded, with lines thinner than a stroke removed), which isolates light caption strokes over busy footage.
 * The more confident reading of each place wins.
 */
async function readText(file: string, duration: number, size: { width: number; height: number }, directory: string, signal: AbortSignal) {
  const engine = await tesseractEngine(signal);
  if (!engine) return { engine: null, languages: [], interval: 1, segments: [] };
  const interval = Math.max(1, Math.ceil(duration / 60));
  await runSceneProcess(ffmpeg(), ['-nostdin', '-v', 'error', '-threads', '1', '-protocol_whitelist', 'file', '-i', file, '-an', '-t', String(duration),
    '-filter_complex', `[0:v:0]fps=1/${interval},scale=w='min(960,iw)':h=-2,format=gray,split[plain][work];[work]split[a][b];[b]gblur=sigma=10[blur];[a][blur]blend=all_mode=subtract,erosion,dilation,lut=y='if(gt(val,40),0,255)'[edges]`,
    '-map', '[plain]', join(directory, 'text-%04d.png'), '-map', '[edges]', join(directory, 'edge-%04d.png')], signal, 120_000, 1024 * 1024);
  const files = (await readdir(directory)).filter(name => /^text-\d{4}\.png$/.test(name)).sort().slice(0, 60);
  // Same arithmetic as the scale filter, so every block is placed without probing each frame.
  const width = Math.min(960, size.width), height = 2 * Math.round((size.height * width) / size.width / 2);
  const frames: { time: number; blocks: TextBlock[] }[] = [];
  for (let start = 0; start < files.length; start += 3) {
    const batch = files.slice(start, start + 3);
    frames.push(...await Promise.all(batch.map(async (name, offset) => {
      const read = async (image: string) => parseTesseractTsv(await runSceneProcess(engine.binary, [join(directory, image), 'stdout', '-l', engine.languages.join('+'), '--psm', '11', 'tsv'], signal, 30_000, 2 * 1024 * 1024), width, height);
      return { time: (start + offset) * interval, blocks: mergeTextBlocks(await read(name), await read(name.replace('text-', 'edge-'))) };
    })));
  }
  return { engine: 'tesseract' as const, languages: engine.languages, interval, segments: trackTextSegments(frames, interval, duration) };
}

async function pinned(projectId: string, raw: unknown, signal: AbortSignal) {
  const input = grammarInput.parse(raw), pin = projectMediaPin.parse(input.pin);
  if (pin.assetId !== input.assetId || pin.projectId !== projectId || pin.kind !== 'video' || pin.sizeBytes > GRAMMAR_MAX_BYTES) throw Error('Edit analysis requires a pinned video of at most 64 MiB');
  return { input, pin, file: (await inspectProjectReference(projectId, pin.assetId, signal, pin)).file };
}
export async function analyzeProjectGrammar(projectId: string, raw: unknown, signal: AbortSignal) {
  const { input, pin, file } = await pinned(projectId, raw, signal);
  if (!input.engine || input.engine !== await grammarEngineIdentity(input.text, signal)) throw Error('Original edit-analysis tools changed; restore them to resume this job');
  const directory = await mkdtemp(join(tmpdir(), 'vh-grammar-'));
  try {
    const source = join(directory, 'source.bin');
    await copyFile(file, source, constants.COPYFILE_EXCL);
    if (await fileHash(source, signal) !== pin.sha256) throw Error('Reference changed while copying');
    const media = await probeMedia(source, 'video', signal), duration = (media.durationMs ?? 0) / 1000;
    if (!(duration > 0) || duration > GRAMMAR_MAX_SECONDS || !media.width || !media.height) throw Error('Edit analysis supports videos up to ten minutes');
    const motion = await readMotion(source, duration, media.width, media.height, signal);
    const text = input.text ? await readText(source, duration, { width: media.width, height: media.height }, directory, signal) : { engine: null, languages: [], interval: 1, segments: [] };
    const analysis = grammarAnalysis.parse({ algorithm: 'viral-hit-grammar-v1', duration,
      motion: { fps: motion.fps, width: motion.width, height: motion.height, dx: motion.samples.map(item => item.dx), dy: motion.samples.map(item => item.dy), zoom: motion.samples.map(item => item.zoom), diff: motion.samples.map(item => item.diff) }, text });
    return grammarReceipt.parse({ ...pin, analysis });
  } finally { await rm(directory, { recursive: true, force: true }); }
}
const inputDigest = (raw: unknown) => fingerprint(grammarInput.parse(raw) as unknown as Json);
/** Local and deterministic like scene detection: replayed from its receipt, no credits. */
export function createGrammarAdapter(): Adapter {
  return {
    recovery: 'replay', execution: { timeoutMs: 300_000, abortOnCancel: true },
    async submit(raw, context) {
      if (!context.projectId) throw new RejectedSubmission('Edit analysis requires a project');
      return { id: JSON.stringify({ inputDigest: inputDigest(raw), receipt: await analyzeProjectGrammar(context.projectId, raw, context.signal) }) };
    },
    async poll(id, raw) {
      const saved = JSON.parse(id);
      if (saved.inputDigest !== inputDigest(raw)) throw Error('Edit analysis receipt does not match its request');
      return { state: 'succeeded', output: grammarReceipt.parse(saved.receipt) as unknown as Json };
    },
    async cancel() { return { state: 'canceled' }; },
  };
}
