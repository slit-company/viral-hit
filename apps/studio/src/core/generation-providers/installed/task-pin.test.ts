import test from 'node:test';
import assert from 'node:assert/strict';
import { InstalledProviderRuntime } from './runtime.server';
import { providerManifestSchema } from './manifest';
import type { EffectRecord } from '@/core/adapters/base-adapter';

test('managed queued provider tasks pin code/model/configuration before executing any status callback',async()=>{
  const manifest=providerManifestSchema.parse({schemaVersion:1,kind:'viral-hit-provider',id:'pinned-test',label:'Pinned provider',environment:['VH_RUNTIME_TEST_SETTING'],models:[{id:'pinned-image',name:'Pinned image',kind:'image',aspectRatios:['1:1']}]});
  const source="export async function createGeneration(){return {status:'processing',taskId:'remote-job-123'};} export async function checkStatus({taskId}){process.env.VH_RUNTIME_PIN_CALLS=String(Number(process.env.VH_RUNTIME_PIN_CALLS||0)+1); if(taskId!=='remote-job-123')throw Error('Wrong upstream ID'); return {status:'pending',taskId};}";
  const effect={linkName:'pinned-image'} as EffectRecord;
  process.env.VH_RUNTIME_TEST_SETTING='original';delete process.env.VH_RUNTIME_PIN_CALLS;
  try{
    const runtime=new InstalledProviderRuntime(manifest,source,true),created=await runtime.call('createGeneration',effect,{input:{}});
    const output=created.output as {taskId:string;upstreamTaskId:string};assert.match(output.taskId,/^vh-runtime-v1:/);assert.equal(output.upstreamTaskId,'remote-job-123');
    const polled=await runtime.call('checkStatus',effect,{taskId:output.taskId});assert.equal(polled.status,'pending');assert.equal(process.env.VH_RUNTIME_PIN_CALLS,'1');
    await assert.rejects(new InstalledProviderRuntime(manifest,source+'\n// changed',true).call('checkStatus',effect,{taskId:output.taskId}),/Restore the original runtime/);
    process.env.VH_RUNTIME_TEST_SETTING='changed';await assert.rejects(runtime.call('checkStatus',effect,{taskId:output.taskId}),/Restore the original runtime/);
    process.env.VH_RUNTIME_TEST_SETTING='original';await assert.rejects(runtime.call('checkStatus',effect,{taskId:'untracked-old-id'}),/original operator runtime/);
    assert.equal(process.env.VH_RUNTIME_PIN_CALLS,'1');
    assert.equal((await new InstalledProviderRuntime(manifest,source,true).call('checkStatus',effect,{taskId:output.taskId})).status,'pending');assert.equal(process.env.VH_RUNTIME_PIN_CALLS,'2');
  }finally{delete process.env.VH_RUNTIME_TEST_SETTING;delete process.env.VH_RUNTIME_PIN_CALLS;}
});
