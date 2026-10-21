import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync, execFile } from 'node:child_process';
import { changeRuntimePackages, inspectRuntimePackage, reviewRuntimeRemoval } from './service.server';
import { readRuntimeRelease, readRuntimeCatalog, runtimeHistory } from './storage.server';
import { managedRuntimeEntries } from './snapshot.server';
import { buildRuntimePackage } from './files.server';
import type { RuntimePackage } from './contract';
const keys=['VIRAL_HIT_DATA_DIR','VIRAL_HIT_ADAPTERS_DIR','VIRAL_HIT_PROVIDERS_DIR','VIRAL_HIT_PUBLISHING_CONNECTORS_DIR'] as const;
function fixture(run:(root:string)=>void|Promise<void>) {
  const before=Object.fromEntries(keys.map(key=>[key,process.env[key]])),root=mkdtempSync(join(tmpdir(),'vh-managed-runtime-'));
  for(const key of keys)delete process.env[key];process.env.VIRAL_HIT_DATA_DIR=root;
  return Promise.resolve().then(()=>run(root)).finally(()=>{for(const key of keys){if(before[key]===undefined)delete process.env[key];else process.env[key]=before[key];}rmSync(root,{recursive:true,force:true});});
}
function mixed():RuntimePackage {
  return buildRuntimePackage({schemaVersion:1,kind:'viral-hit-runtime-package',id:'independent-kit',version:'1.0.0',title:'Independent creative engines',description:'General and specialist runtimes',scope:'general',author:'Independent author',license:'MIT',entries:[
    {kind:'adapter',path:resolve('../../examples/adapters/tone')},
    {kind:'provider',path:resolve('../../examples/providers/procedural-images')},
    {kind:'publishing',path:resolve('../../examples/publishing-connectors/local-archive')},
  ]});
}
function apply(pkg:RuntimePackage) {const review=inspectRuntimePackage(pkg);assert.deepEqual(review.blocking,[]);return changeRuntimePackages({action:'apply',package:review.package,expectedDigest:review.digest,expectedStateDigest:review.stateDigest,trustCode:true});}
const child=(code:string,env=process.env)=>JSON.parse(execFileSync(process.execPath,['--import','tsx','--input-type=module','-e',code],{env,encoding:'utf8'}));

test('mixed general/specialized packages inspect full source without importing and activate only in fresh processes',()=>fixture(()=>{
  const pkg=mixed();pkg.scope='specialized';for(const entry of pkg.entries){entry.source='throw Error("DO_NOT_EXECUTE_AT_INSTALL");\n'+entry.source;if(entry.kind==='adapter')entry.manifest.sha256=createHash('sha256').update(entry.source).digest('hex');}
  const review=inspectRuntimePackage(pkg);assert.ok(review.package.entries.every(entry=>entry.source.startsWith('throw Error')));apply(pkg);
  assert.equal(managedRuntimeEntries('adapter').length,0);
  const result=child("import { externalCatalog } from './src/core/harness/external-catalog.ts'; import { installGenerationProviders } from './src/core/generation-providers/installed/install.server.ts'; import { installedConnectorCatalog } from './src/core/publishing/installed/catalog.server.ts'; console.log(JSON.stringify({adapters:externalCatalog().map(e=>e.descriptor.operation),providers:installGenerationProviders(),connectors:installedConnectorCatalog()}));");
  assert.deepEqual(result.adapters,['ext.example-tone']);assert.equal(result.providers.providers[0].id,'procedural-images');assert.equal(result.providers.problems.length,0);assert.equal(result.connectors.connectors[0].id,'ext.local-archive');
}));

test('reviewed update/remove retains exact releases; active processes preserve their loaded bytes and stale reviews fail',()=>fixture(()=>{
  const first=mixed();apply(first);const original=readRuntimeRelease(first.id),next=structuredClone(original);next.version='2.0.0';next.entries[0].source+='\n// release 2\n';next.entries[0].manifest.sha256=createHash('sha256').update(next.entries[0].source).digest('hex');
  const reviewed=inspectRuntimePackage(next);apply(next);assert.equal(readRuntimeRelease(first.id).version,'2.0.0');
  assert.throws(()=>changeRuntimePackages({action:'apply',package:next,expectedDigest:reviewed.digest,expectedStateDigest:reviewed.stateDigest,trustCode:true}),/changed after review/);
  const history=runtimeHistory(first.id);assert.equal(history.releases.length,2);assert.deepEqual(readRuntimeRelease(first.id,history.releases.find(v=>v.version==='1.0.0')!.digest),original);
  const review=reviewRuntimeRemoval(first.id);changeRuntimePackages({action:'remove',id:first.id,expectedStateDigest:review.stateDigest});assert.equal(readRuntimeCatalog().packages.length,0);assert.equal(runtimeHistory(first.id).releases.length,2);
  apply(original);assert.equal(readRuntimeRelease(first.id).version,'1.0.0');
}));

test('conflicting identities, source hashes, operator changes and missing trust reject before mutation',()=>fixture(()=>{
  const pkg=mixed();const bad=structuredClone(pkg);bad.entries[0].source+='x';assert.throws(()=>inspectRuntimePackage(bad),/SHA-256/);
  const duplicate=structuredClone(pkg);duplicate.entries.push(duplicate.entries[0]);assert.throws(()=>inspectRuntimePackage(duplicate),/Duplicate runtime/);
  const builtin=structuredClone(pkg);(builtin.entries[1].manifest.models as {id:string}[])[0].id='nano-banana-pro';assert.ok(inspectRuntimePackage(builtin).blocking.some(reason=>reason.includes('already used')));
  const review=inspectRuntimePackage(pkg);assert.throws(()=>changeRuntimePackages({action:'apply',package:pkg,expectedDigest:review.digest,expectedStateDigest:review.stateDigest,trustCode:false} as never));
  process.env.VIRAL_HIT_ADAPTERS_DIR=resolve('../../examples/adapters/tone');assert.throws(()=>changeRuntimePackages({action:'apply',package:pkg,expectedDigest:review.digest,expectedStateDigest:review.stateDigest,trustCode:true}),/changed after review/);
  assert.ok(inspectRuntimePackage(pkg).blocking.length);assert.equal(readRuntimeCatalog().packages.length,0);delete process.env.VIRAL_HIT_ADAPTERS_DIR;
  apply(pkg);const other={...pkg,id:'another-kit'};assert.ok(inspectRuntimePackage(other).blocking.length);assert.equal(readRuntimeCatalog().packages.length,1);
}));

test('two actual CLI writers serialize one reviewed catalog without losing retained releases',()=>fixture(async root=>{
  const pkg=mixed();apply(pkg);const next={...pkg,version:'2.0.0'},review=inspectRuntimePackage(next);
  const request={action:'apply',package:review.package,expectedDigest:review.digest,expectedStateDigest:review.stateDigest,trustCode:true};
  const run=()=>new Promise<string>((resolve,reject)=>{const c=execFile(process.execPath,['--import','tsx','scripts/runtime-package.ts','change'],{env:process.env,maxBuffer:2_000_000},(error,stdout,stderr)=>error?reject(new Error(stderr)):resolve(stdout));c.stdin!.end(JSON.stringify(request));});
  const outcomes=await Promise.allSettled([run(),run()]);assert.equal(outcomes.filter(item=>item.status==='fulfilled').length,1);assert.equal(runtimeHistory(pkg.id).releases.length,2);
  const out=join(root,'export.json');execFileSync(process.execPath,['--import','tsx','scripts/runtime-package.ts','export',pkg.id,out],{env:process.env,stdio:'pipe'});assert.deepEqual(JSON.parse(readFileSync(out,'utf8')),review.package);
}));

test('HTTP requires trusted bounded JSON, rejects paths and stale changes, and returns only metadata on list',()=>fixture(async()=>{
  const {runtimePackagesGet,runtimePackagesPost}=await import('@/routes/api/app/runtime-packages/-http.server');
  const pkg=mixed(),review=inspectRuntimePackage(pkg),payload={action:'apply',package:pkg,expectedDigest:review.digest,expectedStateDigest:review.stateDigest,trustCode:true};
  const request=(body:unknown,trusted=true)=>new Request('http://localhost/api/app/runtime-packages',{method:'POST',headers:{'content-type':'application/json',...(trusted?{'x-viral-hit-workspace-request':'1'}:{})},body:JSON.stringify(body)});
  assert.equal((await runtimePackagesPost(request(payload,false))).status,403);
  assert.equal((await runtimePackagesPost(request({...payload,path:'/tmp/untrusted-code'}))).status,400);
  assert.equal((await runtimePackagesPost(request(payload))).status,200);
  assert.equal((await runtimePackagesPost(request(payload))).status,409);
  const list=await runtimePackagesGet().json();assert.equal(list.installed.length,1);assert.equal(list.restartRequired,true);assert.equal(JSON.stringify(list).includes('export async'),false);
}));

test('diagnostic refresh clears a removed pending package without contaminating loaded provider diagnostics',()=>fixture(async()=>{
  const {extensionDiagnostics}=await import('../extensions/diagnostics.server');
  const {generationProviderDiagnostics}=await import('../generation-providers/installed/install.server');
  const before=await extensionDiagnostics(),problems=structuredClone(generationProviderDiagnostics().problems),pkg=mixed();
  assert.equal(before.restartRequired,false);apply(pkg);
  for(let attempt=0;attempt<2;attempt++) {
    const pending=await extensionDiagnostics();assert.equal(pending.restartRequired,true);
    assert.deepEqual(pending.groups,before.groups);
    assert.deepEqual(generationProviderDiagnostics().problems,problems);
  }
  const removal=reviewRuntimeRemoval(pkg.id);changeRuntimePackages({action:'remove',id:pkg.id,expectedStateDigest:removal.stateDigest});
  const after=await extensionDiagnostics();assert.equal(after.restartRequired,false);assert.deepEqual(after.groups,before.groups);
}));
