import { constants, openSync, fstatSync, readFileSync, closeSync, writeFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { z } from 'zod';
import { readExternalCatalog } from '@/core/harness/external-catalog';
import { readProviderFolder } from '@/core/generation-providers/installed/install.server';
import { readConnectorFolder } from '@/core/publishing/installed/catalog.server';
import { MAX_RUNTIME_PACKAGE_BYTES, runtimePackageSchema, runtimeKind, type RuntimeEntry, type RuntimePackage } from './contract';
import { validateRuntimePackage } from './validation.server';

export function readRuntimeJson(path:string) {
  if (!isAbsolute(path)) throw new Error('Use an absolute local file path');
  const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try { const info=fstatSync(fd); if (!info.isFile()||info.size>MAX_RUNTIME_PACKAGE_BYTES||info.size<1) throw new Error('Runtime package must be a bounded regular JSON file'); return JSON.parse(readFileSync(fd,'utf8')); }
  finally { closeSync(fd); }
}
const buildSchema=runtimePackageSchema.omit({entries:true}).extend({entries:z.array(z.object({kind:runtimeKind,path:z.string().refine(isAbsolute,'Use absolute source directories')}).strict()).min(1).max(16)}).strict();
export function buildRuntimePackage(raw:unknown) {
  const input=buildSchema.parse(raw), entries:RuntimeEntry[]=[];
  for (const source of input.entries) {
    if (source.kind==='adapter') for (const entry of readExternalCatalog(source.path)) entries.push({kind:'adapter',manifest:entry.descriptor as RuntimeEntry['manifest'],source:entry.source});
    else if (source.kind==='provider') {const entry=readProviderFolder(source.path);entries.push({kind:'provider',manifest:entry.manifest as RuntimeEntry['manifest'],source:entry.source});}
    else {const entry=readConnectorFolder(source.path);entries.push({kind:'publishing',manifest:entry.manifest as RuntimeEntry['manifest'],source:entry.source});}
  }
  return validateRuntimePackage({...input,entries});
}
export function writeRuntimePackage(path:string,pkg:RuntimePackage) {
  if (!isAbsolute(path)) throw new Error('Use an absolute new file path');
  // Compact output stays inside the same byte bound accepted by readers.
  writeFileSync(path,JSON.stringify(pkg),{flag:'wx',mode:0o600});return {path,id:pkg.id};
}
