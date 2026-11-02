import { cp, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Real bytes for the Cinema transport/worker/editor flow; no AI inference or network access. */
export async function prepareCinemaFixture(directory, providers) {
  const folder = join(providers, 'cinema-fixture');
  await mkdir(folder, { recursive: true });
  await cp('public/logo.png', join(directory, 'cinema-keyframe.png'));
  const referenceInputs = { image: { min: 0, max: 4 }, video: { min: 0, max: 0 }, audio: { min: 0, max: 0 } };
  const common = { aspectRatios: ['16:9', '9:16', '1:1'], defaultAspectRatio: '16:9' };
  const manifest = { schemaVersion: 1, kind: 'viral-hit-provider', id: 'cinema-fixture', label: 'Cinema local fixture', referenceDelivery: 'project-media', models: [
    { ...common, id: 'cinema-keyframe-fixture', name: 'Local keyframe fixture', kind: 'image', studioTasks: ['image-generate', 'image-edit'], referenceInputs },
    { ...common, id: 'cinema-video-fixture', name: 'Local video fixture', kind: 'video', studioTasks: ['video-generate'], durations: ['3s', '5s', '8s'], defaultDuration: '3s',
      referenceInputs, videoImageInputs: { frames: 2, references: 4 }, controls: [{ key: 'reference_mode', label: 'Image use', type: 'select', default: 'frames', choices: [{ value: 'frames', label: 'Frames' }, { value: 'references', label: 'References' }] }] },
  ] };
  await writeFile(join(folder, 'provider.json'), JSON.stringify(manifest));
  await writeFile(join(folder, 'provider.mjs'), `import { readFile } from 'node:fs/promises'; import { join } from 'node:path';
export async function createGeneration({ model }) {
 const video = model.kind === 'video';
 return { status: 'succeeded', media: [{ data: new Uint8Array(await readFile(join(process.env.VIRAL_HIT_DATA_DIR, video ? 'fixture-motion.mp4' : 'cinema-keyframe.png'))), mimeType: video ? 'video/mp4' : 'image/png' }] };
}`);
}
