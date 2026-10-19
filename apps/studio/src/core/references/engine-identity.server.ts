import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';

export function youtubeEngineIdentity(): string | null {
  const engine = process.env.VIRAL_HIT_YOUTUBE_ENGINE;
  if (!engine || !isAbsolute(engine)) return null;
  try {
    const hash = createHash('sha256');
    hash.update(JSON.stringify([engine, process.env.VIRAL_HIT_DOTNET || 'dotnet',
      process.env.VIRAL_HIT_FFMPEG || 'ffmpeg', process.env.VIRAL_HIT_FFPROBE || 'ffprobe']));
    const files = [engine, ...['YoutubeExplode.dll', 'YoutubeIntake.deps.json', 'YoutubeIntake.runtimeconfig.json'].map(name => join(dirname(engine), name))];
    for (const file of files) {
      const stat = lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > 5 * 1024 * 1024) return null;
      const bytes = readFileSync(file);
      if (bytes.length !== stat.size) return null;
      hash.update(JSON.stringify([file, bytes.length])); hash.update(bytes);
    }
    return hash.digest('hex');
  } catch { return null; }
}
