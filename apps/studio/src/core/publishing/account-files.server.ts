import { constants, closeSync, lstatSync, mkdirSync, openSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { PublicationAccountError } from './account-contract';

export function accountStorageRoot(directory: string) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stat = lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new PublicationAccountError('vault-unavailable');
  return realpathSync(directory);
}
export function accountFile(root: string, name: string) {
  if (!/^[a-zA-Z0-9_.-]+$/.test(name) || name === '.' || name === '..') throw new PublicationAccountError('vault-unavailable');
  const file = join(root, name), stat = lstatSync(file, { throwIfNoEntry: false });
  if (stat && (!stat.isFile() || stat.isSymbolicLink())) throw new PublicationAccountError('vault-unavailable');
  return file;
}
export function createPrivateAccountFile(file: string) {
  try { closeSync(openSync(file, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
}
