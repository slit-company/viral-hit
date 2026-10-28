import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import adapter from '../src/adapter.mjs';
import { hash, configuration, validateTarget } from '../src/config.mjs';
import { report, validateEvidence } from '../src/report.mjs';

const keys = ['VIRAL_HIT_REA_NODE','VIRAL_HIT_REA_CLI','VIRAL_HIT_REA_CLI_SHA256','VIRAL_HIT_REA_TARGETS','VIRAL_HIT_REA_EVIDENCE_DIR'];
const evidence = { evidence_id: 'ev_' + 'a'.repeat(64), operation: 'analyze_javascript_application', normalized_result: { graph: { nodes: [{ kind: 'javascript-module', observations: [{ label: 'search.js:search', evidence: { state: 'inferred', location: { value: { source: 'search.js', start: { line: 3 } } } } }] }] } }, limitations: ['Static evidence only'] };
async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'vh-rea-test-')), before = Object.fromEntries(keys.map(key=>[key,process.env[key]]));
  try {
    await mkdir(join(root,'scripts')); const cli = join(root,'scripts/rea.mjs');
    const source = `console.log(${JSON.stringify(JSON.stringify(evidence))});`;
    await writeFile(cli, source); await writeFile(join(root,'package.json'),JSON.stringify({name:'rea-agents',version:'6.8.0'}));
    const targets = join(root,'targets.json'); await writeFile(targets,JSON.stringify({schemaVersion:1,targets:[{id:'fixture',label:'Fixture',kind:'javascript',path:root}]}));
    const env={VIRAL_HIT_REA_NODE:process.execPath,VIRAL_HIT_REA_CLI:cli,VIRAL_HIT_REA_CLI_SHA256:hash(source),VIRAL_HIT_REA_TARGETS:targets,VIRAL_HIT_REA_EVIDENCE_DIR:join(root,'evidence')};Object.assign(process.env,env);
    await run({root,env,cli,targets,input:{kind:'javascript',targetId:'fixture',question:'How does search work?'},context:{projectId:'project-a',key:'request-a',signal:new AbortController().signal}});
  } finally { for(const key of keys){if(before[key]===undefined)delete process.env[key];else process.env[key]=before[key];} await rm(root,{recursive:true,force:true}); }
}
test('only registered target IDs and an exact loopback browser/origin pairing are admitted',()=>fixture(async({targets,env})=>{
  await assert.rejects(configuration('unknown'),/not configured/);
  assert.throws(()=>validateTarget({id:'x',label:'X',kind:'website',endpoint:'http://192.168.1.1:9222',origin:'https://example.com',targetId:'a'}),/loopback/);
  assert.throws(()=>validateTarget({id:'x',label:'X',kind:'website',endpoint:'http://127.0.0.1:9222',origin:'https://example.com/path',targetId:'a'}),/exact website origin/);
  await writeFile(targets,JSON.stringify({schemaVersion:1,targets:[{id:'x',label:'X',kind:'javascript',path:'/a'},{id:'x',label:'X',kind:'javascript',path:'/b'}]}));
  await assert.rejects(configuration('x',env),/Duplicate/);
}));
test('reports retain evidence identities, preserve inference and recover without rerunning the target',()=>fixture(async({env,input,context,cli})=>{
  const {id}=await adapter.submit(input,context);const result=await adapter.poll(id,input,context.signal,{projectId:context.projectId});
  assert.equal(result.state,'succeeded');assert.equal(result.output.facts[0].status,'inferred');assert.equal(result.output.facts[0].source,'search.js:3');
  const file=join(env.VIRAL_HIT_REA_EVIDENCE_DIR,id,'application.json');const raw=await readFile(file);assert.equal(hash(raw),result.output.evidence[0].sha256);
  assert.equal((await stat(file)).mode & 0o777,0o600);assert.deepEqual(await adapter.reconcile(input,context),{id});assert.deepEqual(await adapter.submit(input,context),{id});
  const wrongProject = await adapter.poll(id,input,context.signal,{projectId:'project-b'});
  assert.equal(wrongProject.state,'uncertain');assert.match(wrongProject.error,/identity mismatch/);assert.equal(wrongProject.output,undefined);
  await writeFile(cli,'throw Error("changed")');const changed = await adapter.poll(id,input,context.signal,{projectId:context.projectId});
  assert.equal(changed.state,'uncertain');assert.match(changed.error,/digest mismatch/);
}));
test('interrupted intents cannot be silently reobserved and occupied locks prevent concurrent engines',()=>fixture(async({env,input,context})=>{
  const id=hash(JSON.stringify([input,context.key]));await mkdir(join(env.VIRAL_HIT_REA_EVIDENCE_DIR,id),{recursive:true});
  assert.equal(await adapter.reconcile(input,context),null);await assert.rejects(adapter.submit(input,context),/EEXIST/);
  await mkdir(join(env.VIRAL_HIT_REA_EVIDENCE_DIR,'.analysis-lock'));
  await assert.rejects(adapter.submit(input,{...context,key:'another'}),/holds this evidence-directory lock/);
}));
test('bounded summaries preserve partial failures and do not turn an error envelope into evidence',()=>{
  assert.throws(()=>validateEvidence({error:'missing target'},'inspect_web_page'),/unexpected evidence/);
  const result=report({input:{question:'Inspect'},target:{id:'x',label:'X',kind:'website'},projectId:'p',receiptId:'b'.repeat(64),evidence:[{value:{...evidence,operation:'inspect_web_page'},bytes:Buffer.from('{}'),file:'page.json'}],failure:'Source analysis exceeded its time limit'});
  assert.equal(result.status,'partial');assert.ok(result.limitations.includes('Source analysis exceeded its time limit'));
});
test('multibyte observations fit the retained summary byte limit with an explicit omission marker',()=>{
  const large={...evidence,limitations:Array.from({length:30},(_,i)=>i+'한'.repeat(1000)),normalized_result:{graph:{nodes:[{kind:'module',observations:Array.from({length:80},()=>({label:'한'.repeat(500),evidence:{state:'observed',location:{value:{source:'한'.repeat(250)}}}}))}]}}};
  const result=report({input:{question:'한'.repeat(2000)},target:{id:'x',label:'X',kind:'javascript'},projectId:'p',receiptId:'b'.repeat(64),evidence:[{value:large,bytes:Buffer.from('{}'),file:'application.json'}]});
  assert.ok(Buffer.byteLength(JSON.stringify(result))<=96000);assert.match(result.limitations[0],/UTF-8 byte budget/);assert.ok(result.facts.length<80);
});
test('upstream incomplete coverage remains partial and observed links are not inferred behavior',()=>{
  const value={...evidence,operation:'inspect_web_page',normalized_result:{completeness:{status:'policy_filtered'},metadata:{dom_urls:[{attribute:'href',destination_scope:'approved',url:'https://example.com/search?session=redacted',node_index:4},{attribute:'href',destination_scope:'outside_policy',url:'https://outside.test',node_index:5}]}}};
  const result=report({input:{question:'Search'},target:{id:'x',label:'X',kind:'website'},projectId:'p',receiptId:'b'.repeat(64),evidence:[{value,bytes:Buffer.from('{}'),file:'page.json'}]});
  assert.equal(result.status,'partial');assert.equal(result.facts[1].label,'https://example.com/search');assert.equal(result.facts[1].status,'observed');assert.match(result.facts[1].source,/DOM node 4/);assert.equal(result.facts.length,2);
});
