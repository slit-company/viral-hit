import { resolveProviderConfiguration } from './credentials.server';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { canonicalJson } from '@/lib/canonical-json';
import type { ProviderManifest } from './manifest';
const prefix='vh-runtime-v1:';
const pin=z.object({runtime:z.string().regex(/^[a-f0-9]{64}$/),model:z.string().max(200),taskId:z.string().min(1).max(200)}).strict();
export function providerRuntimeDigest(manifest:ProviderManifest,source:string) {
  return createHash('sha256').update(canonicalJson({manifest,source,environment:manifest.configurationDelivery === 'request' ? Object.fromEntries(Object.entries(resolveProviderConfiguration(manifest)).map(([name,value])=>[name,value||null])) : Object.fromEntries(manifest.environment.map(name=>[name,process.env[name]??null]))})).digest('hex');
}
export function pinProviderTask(taskId:string,runtime:string,model:string){return prefix+Buffer.from(JSON.stringify({runtime,model,taskId})).toString('base64url');}
export function unpinProviderTask(value:unknown,runtime:string,model:string) {
  if(typeof value!=='string'||value.length>1200||!value.startsWith(prefix))throw Error('This task has no managed runtime identity. Restore its original operator runtime to check progress.');
  const parsed=pin.parse(JSON.parse(Buffer.from(value.slice(prefix.length),'base64url').toString('utf8')));
  if(parsed.runtime!==runtime||parsed.model!==model)throw Error('Provider code, model or configuration changed. Restore the original runtime release and configuration to check this task.');
  return parsed.taskId;
}
