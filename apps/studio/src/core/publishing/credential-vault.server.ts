import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { closeSync, constants, existsSync, fstatSync, fsyncSync, linkSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { PublicationAccountError } from './account-contract';
import { accountFile, accountStorageRoot } from './account-files.server';

function sync(file: string) {
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { fsyncSync(fd); } finally { closeSync(fd); }
}
/** Private key is separate from the database. Missing keys never silently replace existing grants. */
export function openCredentialVault(directory: string, configuredHex?: string) {
  const root = accountStorageRoot(directory), file = accountFile(root, 'workspace.key');
  let key: Buffer;
  try {
    if (configuredHex !== undefined) {
      if (!/^[a-fA-F0-9]{64}$/.test(configuredHex)) throw new PublicationAccountError('vault-unavailable');
      key = Buffer.from(configuredHex, 'hex');
    } else {
      if (!existsSync(file)) {
        if (existsSync(accountFile(root, 'accounts.sqlite'))) throw new PublicationAccountError('vault-unavailable');
        const temporary = accountFile(root, `${randomUUID()}.key-pending`);
        try {
          writeFileSync(temporary, randomBytes(32), { flag: 'wx', mode: 0o600 }); sync(temporary);
          try { linkSync(temporary, file); }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
          sync(root); sync(dirname(root));
        } finally { if (existsSync(temporary)) unlinkSync(temporary); }
      }
      const fd = openSync(accountFile(root, 'workspace.key'), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      try { if (fstatSync(fd).size !== 32) throw new PublicationAccountError('vault-unavailable'); key = readFileSync(fd); } finally { closeSync(fd); }
      if (key.length !== 32) throw new PublicationAccountError('vault-unavailable');
    }
  } catch { throw new PublicationAccountError('vault-unavailable'); }
  let closed = false;
  function context(value: string) {
    if (closed || !/^(account|flow)\/[a-zA-Z0-9_-]{1,128}$/.test(value)) throw new PublicationAccountError('vault-unavailable');
    return Buffer.from(`viral-hit/publishing/v1/${value}`);
  }
  return {
    root, fingerprint: createHash('sha256').update(key).digest('hex'),
    close() { closed = true; key.fill(0); },
    seal(identity: string, value: unknown) {
      try {
        const encoded = JSON.stringify(value);
        if (!encoded || Buffer.byteLength(encoded) > 65536) throw new PublicationAccountError('vault-unavailable');
        const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
        cipher.setAAD(context(identity));
        const ciphertext = Buffer.concat([cipher.update(encoded, 'utf8'), cipher.final()]);
        return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64url');
      } catch { throw new PublicationAccountError('vault-unavailable'); }
    },
    open(identity: string, encrypted: string): unknown {
      try {
        if (encrypted.length > 88000 || !/^[a-zA-Z0-9_-]+$/.test(encrypted)) throw new PublicationAccountError('vault-unavailable');
        const bytes = Buffer.from(encrypted, 'base64url');
        if (bytes.length < 29) throw new PublicationAccountError('vault-unavailable');
        const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
        decipher.setAAD(context(identity)); decipher.setAuthTag(bytes.subarray(12, 28));
        return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8'));
      } catch { throw new PublicationAccountError('vault-unavailable'); }
    },
  };
}
export type CredentialVault = ReturnType<typeof openCredentialVault>;
