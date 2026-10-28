import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from '../src/process.mjs';
async function fixture(source, fn) { const root=await mkdtemp(join(tmpdir(),'vh-rea-process-'));try{const cli=join(root,'cli.mjs');await writeFile(cli,source);await fn(cli,root);}finally{await rm(root,{recursive:true,force:true});} }
test('no inherited operator secrets enter the analysis process',()=>fixture('console.log(JSON.stringify({secret:process.env.VH_TEST_SECRET ?? null,args:process.argv.slice(2)}))',async(cli,cwd)=>{
  process.env.VH_TEST_SECRET='private';try{const result=await run(process.execPath,cli,['literal;value'],{cwd,signal:new AbortController().signal});assert.equal(result.secret,null);assert.equal(result.args[0],'literal;value');}finally{delete process.env.VH_TEST_SECRET;}
}));
test('output overflow stops the child',()=>fixture('process.stdout.write("x".repeat(20000));setInterval(()=>{},1000)',async(cli,cwd)=>{
  await assert.rejects(run(process.execPath,cli,[],{cwd,signal:new AbortController().signal,maxBytes:1000}),/output limit/);
}));
test('deadlines and cancellation stop the analysis',()=>fixture('setInterval(()=>{},1000)',async(cli,cwd)=>{
  await assert.rejects(run(process.execPath,cli,[],{cwd,signal:new AbortController().signal,timeoutMs:80}),/time limit/);
  const controller=new AbortController();const pending=run(process.execPath,cli,[],{cwd,signal:controller.signal});setTimeout(()=>controller.abort(),80);await assert.rejects(pending,/canceled/);
}));
