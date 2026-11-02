import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { getProjectAssetById } from '../workspace-lib/assets/user-assets';
import { resolveLocalProjectAssetPath } from '../projects/local-project-assets';
import { readCharacter, referencePath } from './storage.server';
import { compareFaces, faceMatchProblem } from './face-match-engine.server';
import { FACE_MATCH_THRESHOLD, faceSampleTimes, summarizeFaceFrames, type FaceMatchReport } from './face-match';

const run = promisify(execFile);
const ffmpeg = () => process.env.VIRAL_HIT_FFMPEG || 'ffmpeg', ffprobe = () => process.env.VIRAL_HIT_FFPROBE || 'ffprobe';

export type FaceMatchInput = { assetIds: string[]; referenceAssetIds?: string[]; characterId?: string };

async function localAsset(projectId: string, assetId: string, kinds: readonly ('image' | 'video')[]) {
  const asset = await getProjectAssetById({ projectId, assetId });
  if (!asset || !kinds.includes(asset.type as 'image' | 'video') || asset.storageProvider !== 'local') throw Error('Choose ' + kinds.join(' or ') + ' files saved in this project');
  return { type: asset.type as 'image' | 'video', path: resolveLocalProjectAssetPath({ objectKey: asset.objectKey }) };
}

/** A character's main image comes first, then its other angles; project references keep their order. */
async function referenceFiles(projectId: string, input: FaceMatchInput) {
  if (Boolean(input.characterId) === Boolean(input.referenceAssetIds?.length)) throw Error('Compare with either a character or reference images');
  if (input.characterId) {
    const character = readCharacter(input.characterId);
    if (!character || character.status !== 'active') throw Error('Character not found');
    return [...character.references].sort((left, right) => Number(right.role === 'canonical') - Number(left.role === 'canonical')).map(item => referencePath(item.sha256));
  }
  const files = [];
  for (const id of input.referenceAssetIds!) files.push((await localAsset(projectId, id, ['image'])).path);
  return files;
}

/**
 * Scores each project image, or up to eight frames of each video, against the reference faces. One file at
 * a time keeps CPU use low; sampled frames live in a private temporary folder that is always removed.
 */
export async function checkFaceMatch(projectId: string, input: FaceMatchInput): Promise<FaceMatchReport> {
  const problem = await faceMatchProblem();
  if (problem) throw Error(problem);
  const signal = AbortSignal.timeout(180_000);
  const references = await referenceFiles(projectId, input);
  const assets = [];
  for (const id of input.assetIds) assets.push({ id, ...await localAsset(projectId, id, ['image', 'video']) });
  const scratch = await mkdtemp(join(tmpdir(), 'viral-hit-faces-'));
  try {
    const candidates = [];
    for (const [index, asset] of assets.entries()) {
      if (asset.type === 'image') { candidates.push({ id: asset.id, frames: [{ time: null, path: asset.path }] }); continue; }
      const probe = await run(ffprobe(), ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', asset.path], { signal });
      const frames = [];
      for (const [frame, time] of faceSampleTimes(Number(probe.stdout.trim())).entries()) {
        const path = join(scratch, index + '-' + frame + '.jpg');
        await run(ffmpeg(), ['-v', 'error', '-ss', String(time), '-i', asset.path, '-frames:v', '1', '-vf', "scale='min(1280,iw)':-2", '-q:v', '3', '-y', path], { signal });
        frames.push({ time, path });
      }
      candidates.push({ id: asset.id, frames });
    }
    const compared = await compareFaces(references, candidates, signal);
    if (!compared.referenceFaces) throw Error('No face was found in the reference images. Use a clear photo where the face is visible.');
    return {
      engine: 'opencv-sface', threshold: FACE_MATCH_THRESHOLD, referenceImages: references.length, referenceFaces: compared.referenceFaces,
      results: assets.map((asset, index) => {
        const frames = compared.candidates[index].frames;
        return { assetId: asset.id, kind: asset.type, ...summarizeFaceFrames(frames), frames };
      }),
    };
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
