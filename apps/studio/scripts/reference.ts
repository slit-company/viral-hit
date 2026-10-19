import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { importInstagramVideo, importLocalVideoReference, importYouTubeVideo } from '../src/core/references/intake.server';

const usage = 'Usage: pnpm reference --project ID (--youtube VIDEO_ID [--height 720] | --instagram-item /absolute/item.json | --file /absolute/video.mp4)';
const args = process.argv.slice(2), options = new Map<string, string>();
try {
  if (args.length % 2) throw new Error(usage);
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index], value = args[index + 1];
    if (!['--project', '--youtube', '--height', '--instagram-item', '--file'].includes(flag) || options.has(flag) || !value) throw new Error(usage);
    options.set(flag, value);
  }
  const projectId = options.get('--project');
  if (!projectId || ['--youtube', '--instagram-item', '--file'].filter(flag => options.has(flag)).length !== 1
    || (options.has('--height') && !options.has('--youtube'))) throw new Error(usage);
  const signal = AbortSignal.timeout(240000);
  let result;
  if (options.has('--youtube')) result = await importYouTubeVideo(projectId, options.get('--youtube')!, signal, Number(options.get('--height') ?? 720));
  else if (options.has('--file')) result = await importLocalVideoReference(projectId, options.get('--file')!, signal);
  else {
    const file = options.get('--instagram-item')!;
    if (!isAbsolute(file)) throw new Error('An absolute Instagram item file path is required');
    const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    let payload: unknown;
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > 256 * 1024) throw new Error('Instagram input must be a regular JSON file of at most 256 KiB');
      const buffer = Buffer.alloc(256 * 1024 + 1);
      let size = 0;
      while (size < buffer.length) {
        const read = await handle.read(buffer, size, buffer.length - size, null);
        if (!read.bytesRead) break;
        size += read.bytesRead;
      }
      if (size > 256 * 1024) throw new Error('Instagram input exceeded its size limit');
      try { payload = JSON.parse(buffer.subarray(0, size).toString('utf8')); }
      catch { throw new Error('Invalid Instagram item JSON'); }
    } finally { await handle.close(); }
    result = await importInstagramVideo(projectId, payload, signal);
  }
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Reference intake failed');
  process.exitCode = 1;
}
