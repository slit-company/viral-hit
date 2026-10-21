import { execFile } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
const execute = promisify(execFile);

/** A separately installed processor, not a generative model or motion-transfer implementation. */
export async function createGeneration({ model, input, signal, readMedia }) {
  if (!readMedia || input.videoUrls?.length !== 1) throw Error('Choose one local source video');
  const image = model.kind === 'image', { start = 0, seconds = 1 } = input.options ?? {};
  if (!Number.isFinite(start) || start < 0 || start > 600 || !Number.isFinite(seconds) || seconds < .1 || seconds > 10) throw Error('Invalid clip controls');
  const size = { '1:1': [240,240], '16:9': [320,180], '9:16': [180,320] }[input.aspectRatio ?? '1:1'];
  if (!size) throw Error('Unsupported aspect ratio');
  const [width,height] = size;
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(60_000)]);
  const directory = await mkdtemp(join(tmpdir(), 'viral-hit-visual-conform-'));
  const ffmpeg = process.env.VIRAL_HIT_FFMPEG || 'ffmpeg', ffprobe = process.env.VIRAL_HIT_FFPROBE || 'ffprobe';
  const formats = 'mov,matroska,webm,wav,mp3,aac,ogg,flac,png_pipe,jpeg_pipe,webp_pipe,image2';
  const guard = ['-protocol_whitelist','file','-format_whitelist',formats];
  async function local(url, kind, name) {
    const source = await readMedia(url); if(source.kind!==kind)throw Error('Wrong source media kind');
    const path = join(directory,name);await writeFile(path,source.bytes);return path;
  }
  async function probe(path) {
    const {stdout}=await execute(ffprobe,['-v','error',...guard,'-show_format','-show_streams','-of','json',path],{signal:bounded,timeout:15_000,killSignal:'SIGKILL',maxBuffer:1024*1024,encoding:'utf8'});
    return JSON.parse(stdout);
  }
  try {
    const source=await local(input.videoUrls[0],'video','source.mp4'), info=await probe(source);
    const duration=Number(info.format?.duration), stream=info.streams?.find(item=>item.codec_type==='video');
    if(!stream || !Number.isFinite(duration) || start>=duration || (!image && start+seconds>duration+.001))throw Error('Requested range must fit the source video');
    if(!stream.width || !stream.height || stream.width*stream.height>4096*4096)throw Error('Source dimensions exceed this processor limit');
    const args=['-v','error','-nostdin','-threads','2',...guard,'-ss',String(start),'-i',source];
    const scale=`scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1`;
    let filter=`[0:v:0]${scale}[base]`, visual='base', audio='0:a:0?', index=1;
    if (!image && input.imageUrls?.length) {
      const path=await local(input.imageUrls[0],'image','overlay.png');
      args.push(...guard,'-i',path);const tile=Math.floor(width/4/2)*2;
      filter+=`;[${index}:v:0]scale=${tile}:${tile}:force_original_aspect_ratio=decrease[badge];[base][badge]overlay=12:12[out]`;visual='out';index++;
    }
    if (!image && input.audioUrls?.length) {
      const path=await local(input.audioUrls[0],'audio','sound.wav');if(!(await probe(path)).streams?.some(item=>item.codec_type==='audio'))throw Error('Missing audio stream');
      args.push(...guard,'-i',path);audio=`${index}:a:0`;
    }
    args.push('-filter_complex_threads','1','-filter_complex',filter,'-map',`[${visual}]`);
    const destination=join(directory,image?'output.png':'output.mp4');
    if(image)args.push('-frames:v','1','-an','-c:v','png');
    else args.push('-map',audio,'-t',String(seconds),'-r','24','-c:v','libx264','-threads','2','-pix_fmt','yuv420p','-af','apad','-c:a','aac','-movflags','+faststart');
    args.push(destination);
    await execute(ffmpeg,args,{signal:bounded,timeout:30_000,killSignal:'SIGKILL',maxBuffer:1024*1024});
    if((await stat(destination)).size>64*1024*1024)throw Error('Output exceeds processor size limit');
    return {status:'succeeded',media:[{data:new Uint8Array(await readFile(destination)),mimeType:image?'image/png':'video/mp4'}]};
  } finally { await rm(directory,{recursive:true,force:true}); }
}
