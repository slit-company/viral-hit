import { createReadStream, createWriteStream } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import JSZip from 'jszip';
import { buildAudioMix } from './audio-mix.server';
import { captionFilterRequirement, visibleCaptionClips } from './caption-render.server';
import { serializeSrt } from './captions';
import { buildFfmpegArgs } from './render-project-timeline';
import type { TimelineDocument } from './timeline-document';
import { diagnoseTimeline } from './timeline-diagnostics';
import { ffmpegBin, resolveRenderInputs, runProcess, time, type RenderInput } from './timeline-render-inputs.server';

export type LayerFile = { name: string; path: string; kind: 'picture' | 'overlays' | 'captions' | 'subtitles' | 'audio'; description: string };
const STEM_ROLES = ['voice', 'music', 'sfx', 'source'] as const;
const STEM_DESCRIPTIONS: Record<(typeof STEM_ROLES)[number], string> = {
  voice: 'Voice clips at their mixed level (WAV, 48 kHz).',
  music: 'Music clips, and audio clips without a role, at their mixed level (WAV, 48 kHz).',
  sfx: 'Sound effects at their mixed level (WAV, 48 kHz).',
  source: 'Sound recorded inside the video clips at its mixed level (WAV, 48 kHz).',
};
/** Audio clips keep their role (music when unset, as the editor assigns); sound inside video clips is the source stem. */
const stemRole = (input: RenderInput) => (input.clip.sourceType === 'audio' ? (input.clip.audioRole ?? 'music') : 'source');

/**
 * Renders each part of the timeline separately into `directory`: the picture (base track and
 * transitions), overlays and captions on transparency, captions as SRT, and one WAV per audio role.
 * Layers line up frame for frame with the flattened export, and the WAVs add up to its sound.
 */
export async function renderTimelineLayers({ projectId, document, directory }: { projectId: string; document: TimelineDocument; directory: string }) {
  const blocking = diagnoseTimeline(document).find((diagnostic) => diagnostic.severity === 'error');
  if (blocking) throw new Error(`Timeline diagnostics failed: ${blocking.code}`);
  const inputs = await resolveRenderInputs({ projectId, document });
  const files: LayerFile[] = [];
  const render = async (layer: 'picture' | 'overlays' | 'captions', name: string, description: string) => {
    const path = join(directory, name);
    const plan = await buildFfmpegArgs({ document, inputs, directory, outputPath: path, layer });
    await runProcess(ffmpegBin(), plan.args);
    files.push({ name, path, kind: layer, description });
  };
  await render('picture', 'picture.mp4', 'Base track with transitions, no overlays, captions or sound (H.264).');
  if (inputs.some((input) => input.trackKind === 'overlay' && input.clip.overlay)) await render('overlays', 'overlays.mov', 'Image and video overlays on transparency (QuickTime Animation, RGBA).');
  const captions = visibleCaptionClips(document);
  if (captions.length) {
    const filter = captionFilterRequirement(document)!;
    const available = await runProcess(ffmpegBin(), ['-hide_banner', '-filters'], { captureStdout: true });
    if (!new RegExp(`\\b${filter}\\s`).test(available)) throw new Error(`This FFmpeg build cannot render captions: ${filter} is missing. Install a full FFmpeg build and set VIRAL_HIT_FFMPEG.`);
    await render('captions', 'captions.mov', 'Captions, including spoken-word highlights, on transparency (QuickTime Animation, RGBA).');
    const path = join(directory, 'captions.srt');
    await writeFile(path, serializeSrt([...captions].sort((left, right) => left.startTime - right.startTime)
      .map((clip) => ({ startTime: clip.startTime, endTime: clip.startTime + clip.duration, text: clip.text ?? '' }))) + '\n', 'utf8');
    files.push({ name: 'captions.srt', path, kind: 'subtitles', description: 'Caption text and timing (SRT).' });
  }
  const inputArgs = inputs.flatMap((input) => input.clip.sourceType === 'image'
    ? ['-loop', '1', '-framerate', '30', '-t', time(input.clip.duration), '-i', input.filePath]
    : ['-i', input.filePath]);
  for (const role of STEM_ROLES) {
    const mix = buildAudioMix({ inputs, document, include: (input) => stemRole(input) === role, label: 'stem' });
    if (!mix) continue;
    const path = join(directory, `audio-${role}.wav`);
    await runProcess(ffmpegBin(), ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', ...inputArgs,
      '-filter_complex', mix.filters.join(';'), '-map', `[${mix.label}]`, '-t', time(document.duration), '-c:a', 'pcm_s16le', '-ar', '48000', '-ac', '2', path]);
    files.push({ name: `audio-${role}.wav`, path, kind: 'audio', description: STEM_DESCRIPTIONS[role] });
  }
  return files;
}

/** One ZIP of the layers plus a short guide; media is stored without recompression. */
export async function zipTimelineLayers(files: readonly LayerFile[], outputPath: string, title: string) {
  const zip = new JSZip();
  for (const file of files) zip.file(file.name, createReadStream(file.path));
  zip.file('README.txt', [
    `${title}: layers exported by Viral Hit.`,
    'Every file starts at 0:00 and lasts the whole timeline, so stacking them in another editor rebuilds the same video.',
    '', ...files.map((file) => `${file.name} - ${file.description}`), '',
  ].join('\n'));
  await new Promise<void>((resolve, reject) => {
    const output = createWriteStream(outputPath, { flags: 'wx' });
    output.on('finish', () => resolve()).on('error', reject);
    zip.generateNodeStream({ type: 'nodebuffer', streamFiles: true, compression: 'STORE' }).on('error', reject).pipe(output);
  });
}
