import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';

// Replaced by the package build. Tests pass an explicit expected lock digest.
const compiledLock = typeof LOCAL_MEDIA_LOCK_SHA256 === 'undefined' ? null : LOCAL_MEDIA_LOCK_SHA256;
export async function inspectRuntime(root, engine, expectedLock = compiledLock) {
  if (!root || !isAbsolute(root)) throw new Error('VIRAL_HIT_LOCAL_MEDIA_DIR must be an absolute installed package directory');
  if (!expectedLock) throw new Error('Build the local media adapters before installing them');
  const lock = await readFile(join(root, 'package-lock.json'));
  if (createHash('sha256').update(lock).digest('hex') !== expectedLock) throw new Error('Local media lockfile differs from this adapter build');
  const name = engine === 'music' ? 'music2-gen' : 'vid2-gen';
  const version = engine === 'music' ? '0.4.0' : '0.6.0';
  const directory = join(root, 'node_modules', name);
  const pkg = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
  if (pkg.name !== name || pkg.version !== version) throw new Error(`Expected ${name}@${version}`);
  if (engine === 'music') {
    const bunRoot = join(root, 'node_modules/bun');
    const bun = JSON.parse(await readFile(join(bunRoot, 'package.json'), 'utf8'));
    if (bun.version !== '1.4.0' || (await stat(join(bunRoot, 'bin/bun.exe'))).size < 1_000_000) throw new Error('Install the pinned Bun 1.4.0 runtime before starting the worker');
  }
  return { bin: join(directory, 'bin', engine === 'music' ? 'music2.js' : 'vid2.js'), model: `${name}@${version}` };
}

export function childEnvironment(work, engine) {
  const env = {
    PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
    HOME: work, TMPDIR: work, LANG: 'en_US.UTF-8',
    MUSIC2_HOME: join(work, 'music2'), VID2_HOME: join(work, 'vid2'),
  };
  if (engine === 'video') {
    const ffmpeg = process.env.VIRAL_HIT_FFMPEG, ffprobe = process.env.VIRAL_HIT_FFPROBE;
    if (!ffmpeg || !ffprobe || !isAbsolute(ffmpeg) || !isAbsolute(ffprobe)) throw new Error('Set absolute VIRAL_HIT_FFMPEG and VIRAL_HIT_FFPROBE executables');
    env.VID2_FFMPEG = ffmpeg; env.VID2_FFPROBE = ffprobe;
    env.VID2_FFMPEG_TIMEOUT_MS = '90000';
  }
  return env;
}
