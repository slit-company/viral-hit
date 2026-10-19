import { constants, closeSync, openSync } from 'node:fs';
import { resolve } from 'node:path';
import { getViralHitDataRoot } from '../../config/data-root';
import { privateMediaRoot, mediaPath } from './media-files.server';
import { PublicationStore } from './store.server';

export function openPublications(directory = resolve(getViralHitDataRoot(), 'publications')) {
  const root = privateMediaRoot(directory), file = mediaPath(root, ['publications.sqlite']);
  for (const suffix of ['-wal', '-shm']) mediaPath(root, [`publications.sqlite${suffix}`]);
  try { closeSync(openSync(file, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  return new PublicationStore(file);
}
