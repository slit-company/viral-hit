import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getProjectAssetById } from '../workspace-lib/assets/user-assets';
import { resolveLocalProjectAssetPath } from '../projects/local-project-assets';
import { parseAnalysisLog, scoreTake, type TakeQuality } from './quality';

const run = promisify(execFile);
const ffmpeg = () => process.env.VIRAL_HIT_FFMPEG || 'ffmpeg', ffprobe = () => process.env.VIRAL_HIT_FFPROBE || 'ffprobe';

/** Decodes one project video once and scores it; nothing is written or sent anywhere. */
export async function inspectTake(projectId: string, assetId: string, expect: { durationSec?: number; audio?: boolean } = {}): Promise<TakeQuality> {
  const asset = await getProjectAssetById({ projectId, assetId });
  if (!asset || asset.type !== 'video' || asset.storageProvider !== 'local') throw Error('Choose a video saved in this project');
  const file = resolveLocalProjectAssetPath({ objectKey: asset.objectKey });
  const signal = AbortSignal.timeout(120_000);
  const probe = JSON.parse((await run(ffprobe(), ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], { signal, maxBuffer: 1 << 20 })).stdout);
  const video = probe.streams.find((stream: { codec_type: string }) => stream.codec_type === 'video');
  const audio = probe.streams.some((stream: { codec_type: string }) => stream.codec_type === 'audio');
  if (!video) throw Error('The take has no video stream');
  const [num, den] = String(video.avg_frame_rate || '0/1').split('/').map(Number);
  const durationSec = Number(probe.format?.duration) || 0;
  const args = ['-hide_banner', '-nostats', '-i', file, '-vf', 'freezedetect=n=0.003:d=0.6,blackdetect=d=0.3:pix_th=0.10,scdet=threshold=14'];
  if (audio) args.push('-af', 'volumedetect');
  args.push('-f', 'null', '-');
  const { stderr } = await run(ffmpeg(), args, { signal, maxBuffer: 8 << 20 });
  const parsed = parseAnalysisLog(stderr, durationSec);
  return scoreTake({ durationSec, width: video.width, height: video.height, fps: den ? num / den : 0, hasAudio: audio, ...parsed }, expect);
}
