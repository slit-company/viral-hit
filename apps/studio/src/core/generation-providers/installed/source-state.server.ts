import { createHash } from 'node:crypto';
import { lstatSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** Cheap change detection for a process-lifetime provider snapshot; never reads or executes module contents. */
export function providerSourceStamp(directory: string | undefined) {
  if (!directory) return 'unset';
  try {
    const folders = readdirSync(directory, { withFileTypes: true }).filter(item => item.isDirectory() && !item.name.startsWith('.')).sort((a, b) => a.name.localeCompare(b.name));
    if (folders.length > 32) return 'too-many-folders';
    const entries: unknown[] = [];
    for (const folder of folders) {
      const path = join(directory, folder.name), files = readdirSync(path).sort();
      if (files.length > 64) return 'too-many-files';
      entries.push([folder.name, files.map(name => {
        const stat = lstatSync(join(path, name));
        return [name, stat.ino, stat.mode, stat.size, stat.mtimeMs, stat.ctimeMs];
      })]);
    }
    return createHash('sha256').update(JSON.stringify(entries)).digest('hex');
  } catch { return 'unavailable'; }
}
