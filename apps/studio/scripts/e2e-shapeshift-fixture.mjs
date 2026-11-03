import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Two local stand-ins for video models that take a reference video and pictures, with no AI, network or
 * spending: "follow" returns the reference clip's own frames and "mirror" plays them backwards, so a run
 * can check joining, scoring and the best pick. The service reports a balance, as funded services do, and its
 * models only swap subjects, so Studio's other tools and Cinema keep their own choices.
 */
export async function prepareShapeshiftFixture(providers) {
  const folder = join(providers, 'shapeshift-fixture');
  await mkdir(folder, { recursive: true });
  const model = (id, name) => ({ id, name, kind: 'video', studioTasks: ['object-swap'], durations: ['3s', '5s'], defaultDuration: '3s', aspectRatios: ['auto', '16:9'],
    referenceInputs: { image: { min: 1, max: 4 }, video: { min: 1, max: 1 }, audio: { min: 0, max: 0 } } });
  await writeFile(join(folder, 'provider.json'), JSON.stringify({ schemaVersion: 1, kind: 'viral-hit-provider', id: 'shapeshift-fixture', label: 'Shapeshift local fixture',
    referenceDelivery: 'project-media', configurationDelivery: 'request', balanceCheck: true,
    models: [model('shapeshift-follow-fixture', 'Local follow fixture'), model('shapeshift-mirror-fixture', 'Local mirror fixture')] }));
  await writeFile(join(folder, 'provider.mjs'), `import { execFile } from 'node:child_process'; import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os'; import { join } from 'node:path'; import { promisify } from 'node:util';
const execute = promisify(execFile);
export async function createGeneration({ model, input, readMedia, signal }) {
  if (!readMedia || input.videoUrls?.length !== 1 || !input.imageUrls?.length) throw Error('Choose a reference video and a picture');
  const source = await readMedia(input.videoUrls[0]);
  if (model.id === 'shapeshift-follow-fixture') return { status: 'succeeded', media: [{ data: source.bytes, mimeType: 'video/mp4' }] };
  const directory = await mkdtemp(join(tmpdir(), 'vh-shapeshift-fixture-'));
  try {
    await writeFile(join(directory, 'in.mp4'), source.bytes);
    await execute(process.env.VIRAL_HIT_FFMPEG || 'ffmpeg', ['-v', 'error', '-i', join(directory, 'in.mp4'), '-vf', 'reverse', '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(directory, 'out.mp4')], { signal, timeout: 60000 });
    return { status: 'succeeded', media: [{ data: new Uint8Array(await readFile(join(directory, 'out.mp4'))), mimeType: 'video/mp4' }] };
  } finally { await rm(directory, { recursive: true, force: true }); }
}
export async function checkBalance() { return { state: 'known', amount: 25, unit: 'USD' }; }`);
}
