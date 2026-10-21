import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {buildRuntimePackage} from './files.server';
const root=mkdtempSync(join(tmpdir(),'vh-runtime-execution-'));
for(const key of ['VIRAL_HIT_ADAPTERS_DIR','VIRAL_HIT_PROVIDERS_DIR','VIRAL_HIT_PUBLISHING_CONNECTORS_DIR','VIRAL_HIT_RECIPES_DIR','VIRAL_HIT_HARNESS_DB'])delete process.env[key];
process.env.VIRAL_HIT_DATA_DIR=root;process.env.VIRAL_HIT_ARCHIVE_DIR=join(root,'archive');
after(()=>rmSync(root,{recursive:true,force:true}));
execFileSync('pnpm',['exec','drizzle-kit','push','--force'],{env:process.env,stdio:'pipe'});
const first=buildRuntimePackage({schemaVersion:1,kind:'viral-hit-runtime-package',id:'real-local-engines',version:'1.0.0',title:'Real local media',description:'Independent media implementations',scope:'general',author:'QA',license:'MIT',entries:[{kind:'adapter',path:resolve('../../examples/adapters/tone')},{kind:'provider',path:resolve('../../examples/providers/procedural-images')},{kind:'publishing',path:resolve('../../examples/publishing-connectors/local-archive')}]});
function install(pkg:typeof first){const file=join(root,'incoming.json');writeFileSync(file,JSON.stringify(pkg));execFileSync(process.execPath,['--import','tsx','--input-type=module','-e',`import {readFileSync} from 'node:fs'; import {inspectRuntimePackage,changeRuntimePackages} from './src/core/runtime-packages/service.server.ts'; const r=inspectRuntimePackage(JSON.parse(readFileSync(process.argv[1],'utf8'))); changeRuntimePackages({action:'apply',package:r.package,expectedDigest:r.digest,expectedStateDigest:r.stateDigest,trustCode:true});`,file],{env:process.env,stdio:'pipe'});}
install(first);
const {externalCatalog,pinExternalAdapters}=await import('../harness/external-catalog');
const {createExternalAdapter}=await import('../harness/external-adapters');
const {DurableHarness}=await import('../harness/durable');
const {compileRecipe}=await import('../harness/recipes');
const {createMaterializeAdapter}=await import('../harness/materialize');
const {readBinaryReceipt}=await import('../harness/binary-receipts');
const {createProject}=await import('../projects/projects');
const {installGenerationProviders}=await import('../generation-providers/installed/install.server');
assert.equal(installGenerationProviders().providers.length,1);
const {submitAssetFirstGeneration}=await import('../generation-providers/submit');
const {listProjectAssets}=await import('../workspace-lib/assets/user-assets');
const {changePublication,listPublications}=await import('../publishing/application.server');
const {PublicationStore}=await import('../publishing/store.server');
const {openPublicationRuntime}=await import('../publishing/runtime.server');
const {runPublicationStep}=await import('../publishing/worker.server');

test('one managed package executes real WAV processing, PNG generation and local archive delivery through the existing services',async()=>{
  const project=await createProject({name:'Managed engine proof'}),recipe=JSON.parse(readFileSync('../../examples/adapter-recipes/procedural-tone.json','utf8'));
  const entries=externalCatalog();assert.equal(entries.length,1);
  const h=new DurableHarness(':memory:');
  try{
    const run=h.enqueue(pinExternalAdapters(compileRecipe(recipe,{frequency:330,duration:.2},project.id)),'tone');
    for(let i=0;i<4;i++)await h.step(run,{'ext.example-tone':createExternalAdapter(entries[0]),'asset.materialize':createMaterializeAdapter()});
    assert.ok(h.jobs(run).every(job=>job.state==='succeeded'));
    const receipt=await readBinaryReceipt({projectId:project.id,jobId:h.jobs(run)[0].id},AbortSignal.timeout(3000));assert.ok(receipt);
    const bytes=readFileSync(receipt.file);assert.equal(bytes.toString('ascii',0,4),'RIFF');assert.equal(bytes.length,9644);
  }finally{h.close();}
  const generation=await submitAssetFirstGeneration({generation:{version:2,projectId:project.id,modelId:'procedural-gradient',mode:'image',prompt:'Managed local proof',references:[],parameters:{aspect_ratio:'16:9'}},origin:'mcp'});
  assert.equal(generation.status,200);assert.equal(generation.body.status,'succeeded');
  const assets=await listProjectAssets({projectId:project.id});assert.equal(assets.length,2);
  const draft=await changePublication(project.id,{action:'create',requestKey:'proof',connector:'ext.local-archive',accountId:'archive',assetIds:assets.map((asset:{id:string})=>asset.id),metadata:{title:'Managed release',collection:'portfolio'}},'mcp');
  await changePublication(project.id,{action:'approve',publicationId:draft.id,expectedRevision:1,expectedDigest:draft.digest,confirmed:true},'mcp');
  let now=Date.now();const store=new PublicationStore(join(root,'publications/publications.sqlite'),()=>now),runtime=openPublicationRuntime();
  try{for(let i=0;i<10;i++){now+=120000;const result=await runPublicationStep(store,runtime);if(result?.state==='published')break;}assert.equal((await listPublications(project.id)).publications[0].state,'published');}
  finally{store.close();runtime.close();}
  assert.ok(existsSync(process.env.VIRAL_HIT_ARCHIVE_DIR!));
});

test('old loaded adapter stays unchanged; fresh runtime rejects an old pinned job and restoring the retained release restores its identity',()=>{
  const old=externalCatalog()[0],recipe=JSON.parse(readFileSync('../../examples/adapter-recipes/procedural-tone.json','utf8'));
  const plan=pinExternalAdapters(compileRecipe(recipe,{frequency:330,duration:.2},'project'));
  const next=structuredClone(first);next.version='2.0.0';next.entries[0].source+='\n// changed implementation\n';next.entries[0].manifest.sha256=createHash('sha256').update(next.entries[0].source).digest('hex');install(next);
  assert.equal(externalCatalog()[0].digest,old.digest);
  const file=join(root,'input.json');writeFileSync(file,JSON.stringify(plan.nodes[0].input));
  const result=JSON.parse(execFileSync(process.execPath,['--import','tsx','--input-type=module','-e',`import {readFileSync} from 'node:fs'; import {externalCatalog} from './src/core/harness/external-catalog.ts'; import {createExternalAdapter} from './src/core/harness/external-adapters.ts'; const e=externalCatalog()[0];try{await createExternalAdapter(e).submit(JSON.parse(readFileSync(process.argv[1],'utf8')),{key:'old',signal:AbortSignal.timeout(2000),dependencies:{}});throw Error('Should reject');}catch(error){console.log(JSON.stringify({digest:e.digest,error:error.message}));}`,file],{env:process.env,encoding:'utf8'}));
  assert.notEqual(result.digest,old.digest);assert.match(result.error,/changed or was not pinned/);
  install(first);
  const restored=execFileSync(process.execPath,['--import','tsx','--input-type=module','-e',"import {externalCatalog} from './src/core/harness/external-catalog.ts'; console.log(externalCatalog()[0].digest);"],{env:process.env,encoding:'utf8'}).trim();assert.equal(restored,old.digest);
});
