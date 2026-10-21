import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, test } from 'node:test';
import { eq } from 'drizzle-orm';
import { DurableHarness, type Plan, type Adapter, type NodeSpec, type Json } from './durable';
import { compileRecipe } from './recipes';

const directory = await mkdtemp(join(tmpdir(), 'vh-model-recipes-'));
process.env.VIRAL_HIT_DATA_DIR = directory;
process.env.VIRAL_HIT_PROVIDERS_DIR = join(directory, 'providers');
process.env.VH_MODEL_RECIPE_SETTING = 'original';
for (const name of ['VIRAL_HIT_ADAPTERS_DIR', 'VIRAL_HIT_HARNESS_DB']) delete process.env[name];
execFileSync('pnpm', ['exec', 'drizzle-kit', 'push', '--force'], { env: process.env, stdio: 'pipe' });
for (const name of ['procedural-images', 'procedural-audio', 'audio-conform', 'media-inspector']) await cp(resolve('../../examples/providers', name), join(process.env.VIRAL_HIT_PROVIDERS_DIR, name), { recursive: true });
const folder = join(process.env.VIRAL_HIT_PROVIDERS_DIR, 'recipe-specialist'); await mkdir(folder);
const video = join(directory, 'video.mp4'), image = join(directory, 'image.png');
execFileSync(process.env.VIRAL_HIT_FFMPEG || 'ffmpeg', ['-v','error','-f','lavfi','-i','color=c=orange:s=96x96:r=10:d=0.5','-c:v','libx264','-pix_fmt','yuv420p',video]);
execFileSync(process.env.VIRAL_HIT_FFMPEG || 'ffmpeg', ['-v','error','-f','lavfi','-i','color=c=blue:s=64x64','-frames:v','1',image]);
const secondImage = join(directory, 'second.png');
execFileSync(process.env.VIRAL_HIT_FFMPEG || 'ffmpeg', ['-v','error','-f','lavfi','-i','color=c=red:s=80x80','-frames:v','1',secondImage]);
const calls = join(directory, 'calls.jsonl');
const fixtureSource = `
import {appendFileSync,readFileSync} from 'node:fs';
export async function createGeneration({model,input,signal}) {
 signal.throwIfAborted();appendFileSync(${JSON.stringify(calls)},JSON.stringify({action:'create',model:model.id,prompt:input.prompt})+'\\n');
 if(input.prompt==='crash')process.exit(73);
 if(input.prompt==='fail')throw Error('Provider response lost');
 if(input.prompt==='gallery')return {status:'succeeded',media:[{data:readFileSync(${JSON.stringify(image)}),mimeType:'image/png'},{data:readFileSync(${JSON.stringify(secondImage)}),mimeType:'image/png'}]};
 if(input.prompt==='queued')return {status:'processing',taskId:'original-task'};
 return {status:'succeeded',media:[{data:readFileSync(model.kind==='video'?${JSON.stringify(video)}:${JSON.stringify(image)}),mimeType:model.kind==='video'?'video/mp4':'image/png'}]};
}
export async function checkStatus({taskId}) {appendFileSync(${JSON.stringify(calls)},JSON.stringify({action:'check',taskId})+'\\n');return {status:'succeeded',media:[{data:readFileSync(${JSON.stringify(image)}),mimeType:'image/png'}]};}
`;
await writeFile(join(folder, 'provider.mjs'), fixtureSource);
await writeFile(join(folder, 'provider.json'), JSON.stringify({ schemaVersion:1,kind:'viral-hit-provider',id:'recipe-specialist',label:'Recipe specialist',scope:'specialized',environment:['VH_MODEL_RECIPE_SETTING'],models:[{id:'recipe-image',name:'Recipe image',kind:'image',aspectRatios:['1:1']},{id:'recipe-video',name:'Recipe video',kind:'video',aspectRatios:['1:1'],durations:['1s']}] }));
after(async () => { delete process.env.VH_MODEL_RECIPE_SETTING; await rm(directory, { recursive:true,force:true }); });
const { installGenerationProviders } = await import('../generation-providers/installed/install.server');
assert.deepEqual(installGenerationProviders().problems, []);
const { createProject } = await import('../projects/projects');
const { importLocalProjectAsset } = await import('../projects/import-local-asset');
const { getProjectAssetById, listProjectAssets } = await import('../workspace-lib/assets/user-assets');
const { resolveLocalProjectAssetPath } = await import('../projects/local-project-assets');
const { listProjectGenerations } = await import('../effects/project-generations');
const { syncGeneration } = await import('../effects/generation-sync');
const { getDb } = await import('../workspace-lib/db-adapter');
const { generationHistory } = await import('@/config/db/schema');
const { createGenerationModelAdapter, modelGenerationIntentId } = await import('./generation-adapter.server');
const { pinRuntimePlan } = await import('./runtime-plan');
const { createRuntimeAdapters } = await import('./adapters');
const { attachRunResult } = await import('./attach-result');
const { loadProjectTimeline } = await import('../editor/timeline-state');
const { findGenerationIntentReceipt } = await import('../effects/generation-intent-receipt');
const { isAssetJob } = await import('./asset-operations');
const adapters = createRuntimeAdapters();
let now = Date.now();
const events = async () => (await readFile(calls,'utf8').catch(()=> '')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
const node = (prompt = 'image', modelId = 'recipe-image', mode = 'image'): NodeSpec => ({id:'model',operation:'generation.model',version:'1',input:{schemaVersion:1,mode,modelId,prompt,parameters:mode==='image'?{aspect_ratio:'1:1'}:{}}});
async function setup(nodes = [node()]) {
 const project = await createProject({name:'Installed recipe test'}), file=join(directory,project.id+'.sqlite');
 const h=new DurableHarness(file,()=>now), plan=await pinRuntimePlan({projectId:project.id,nodes} as Plan);
 return {project,file,h,plan,run:h.enqueue(plan,'one')};
}
async function finish(h:DurableHarness,run:string, runtime:Record<string,Adapter>=adapters) {
 for(let i=0;i<25;i++){now+=25_000;if(!await h.step(run,runtime))break;}
}

test('general model → referenced audio processor → editable sequence reuses original assets after reopen',async()=>{
 const project=await createProject({name:'Independent multi-model recipe'});
 const raw=JSON.parse(await readFile('../../examples/provider-recipes/calibration-card.json','utf8'));
 const plan=await pinRuntimePlan(compileRecipe(raw,{direction:'Calibration proof'},project.id));
 const file=join(directory,project.id+'.sqlite');let h=new DurableHarness(file,()=>now);
 try{
  const run=h.enqueue(plan,'composed');await finish(h,run);
  assert.deepEqual(h.jobs(run).map(job=>job.state),['succeeded','succeeded','succeeded','succeeded']);
  const jobs=h.jobs(run), tone=JSON.parse(jobs[1].output_json!),conformed=JSON.parse(jobs[2].output_json!);
  assert.equal(tone.durationMs,1000);assert.equal(conformed.durationMs,1000);assert.notEqual(tone.assetId,conformed.assetId);
  const history=await listProjectGenerations(project.id);assert.equal(history.length,3);
  const assets=await listProjectAssets({projectId:project.id});assert.equal(new Set(assets.map((asset: { id: string })=>asset.id)).size,3);
  assert.equal(await loadProjectTimeline(project.id),null);
  const outputJob=jobs[3];assert.equal((await attachRunResult(h,project.id,run,outputJob.id,0)).ok,true);
  const timeline=await loadProjectTimeline(project.id);assert.ok(timeline);assert.deepEqual(timeline.document.tracks.flatMap(track=>track.clips).map(clip=>clip.sourceType),['image','audio']);
  h.close();h=new DurableHarness(file,()=>now);await finish(h,run);
  assert.deepEqual(await listProjectGenerations(project.id),history);assert.equal(h.jobs(run).every(job=>job.attempts===1),true);
  assert.equal(h.enqueue(plan,'composed'),run);
 }finally{h.close();}
});

test('analysis text and generated video use the same installed-model contract without pretending reports are assets',async()=>{
 const project=await createProject({name:'Analysis and video'}),asset=await importLocalProjectAsset({projectId:project.id,filePath:video});
 const nodes: NodeSpec[]=[{id:'analysis',operation:'generation.model',version:'1',input:{schemaVersion:1,mode:'analysis',modelId:'technical-video-review',prompt:'Inspect source',references:[{assetId:asset.id,kind:'video',role:'source'}],parameters:{}}},node('Generate from report','procedural-gradient')];
 nodes[1]={...nodes[1],dependsOn:['analysis'],bindings:[{target:'/prompt',node:'analysis',pointer:'/text'}]};
 const plan=await pinRuntimePlan({projectId:project.id,nodes} as Plan),h=new DurableHarness(join(directory,project.id+'.sqlite'),()=>now);
 try{
  const run=h.enqueue(plan,'report');await finish(h,run);assert.deepEqual(h.jobs(run).map(job=>job.state),['succeeded','succeeded']);
  assert.equal(isAssetJob(h.jobs(run)[0]),false);assert.equal(isAssetJob(h.jobs(run)[1]),true);
  const report=JSON.parse(h.jobs(run)[0].output_json!);assert.equal(report.kind,'analysis');assert.ok(report.text.length>5);
  await assert.rejects(attachRunResult(h,project.id,run,h.jobs(run)[0].id,0),/imported media/);
  const videoPlan=await pinRuntimePlan({projectId:project.id,nodes:[node('Actual video','recipe-video','video')]} as Plan);
  const videoRun=h.enqueue(videoPlan,'video');await finish(h,videoRun);
  assert.equal(h.jobs(videoRun)[0].state,'succeeded');assert.equal(JSON.parse(h.jobs(videoRun)[0].output_json!).durationMs,500);
  assert.equal((await attachRunResult(h,project.id,videoRun,h.jobs(videoRun)[0].id,0)).ok,true);
 }finally{h.close();}
});

test('lost submit response reconciles its deterministic intent with exactly one generation',async()=>{
 const f=await setup(),original=adapters['generation.model'];let submissions=0;
 const lost={...original,async submit(...args:Parameters<Adapter['submit']>){submissions++;await original.submit(...args);throw Error('Lost local response');}};
 try{
  await f.h.step(f.run,{'generation.model':lost});assert.equal(f.h.jobs(f.run)[0].state,'submitting');
  now+=3000;await f.h.step(f.run,{'generation.model':lost});assert.equal(f.h.jobs(f.run)[0].state,'running');
  await finish(f.h,f.run);assert.equal(f.h.jobs(f.run)[0].state,'succeeded');assert.equal(submissions,1);
  assert.equal((await listProjectGenerations(f.project.id)).length,1);
  const job=f.h.jobs(f.run)[0];assert.equal(job.provider_id,modelGenerationIntentId(f.project.id,job.idempotency_key));
  const saved=join(directory,'completed-job.json');await writeFile(saved,JSON.stringify(f.plan.nodes[0].input));
  const observed=JSON.parse(execFileSync(process.execPath,['--import','tsx','--input-type=module','-e',`import{readFileSync}from 'node:fs';import{createGenerationModelAdapter}from './src/core/harness/generation-adapter.server.ts';console.log(JSON.stringify(await createGenerationModelAdapter().poll(process.argv[2],JSON.parse(readFileSync(process.argv[1],'utf8')),AbortSignal.timeout(5000),{projectId:process.argv[3],runId:process.argv[4],jobId:process.argv[5]})));`,saved,job.provider_id!,f.project.id,f.run,job.id],{env:{...process.env,VIRAL_HIT_PROVIDERS_DIR:join(directory,'removed')},encoding:'utf8'}));
  assert.equal(observed.state,'succeeded');assert.equal(observed.output.assetId,JSON.parse(job.output_json!).assetId);
 }finally{f.h.close();}
});

test('queued operator-folder models pin task callbacks; changed configuration stays uncertain until original runtime returns',async()=>{
 const f=await setup([node('queued')]);
 try{
  await f.h.step(f.run,adapters);const job=f.h.jobs(f.run)[0];assert.ok(job.provider_id);
  const receipt=await findGenerationIntentReceipt({projectId:f.project.id,intentId:job.provider_id});assert.ok(receipt?.generation);
  assert.match(receipt.generation.providerTaskId!,/^vh-runtime-v1:/);
  await (await getDb()).update(generationHistory).set({lastProviderSyncAt:new Date(0)}).where(eq(generationHistory.id,receipt.generation.id));
  const before=await events();
  const snapshot=join(directory,'pinned-job.json');await writeFile(snapshot,JSON.stringify(f.plan.nodes[0].input));
  await writeFile(join(folder,'provider.mjs'),fixtureSource+'\n// changed release');
  try {
    const observed=JSON.parse(execFileSync(process.execPath,['--import','tsx','--input-type=module','-e',`import{readFileSync}from 'node:fs';import{createGenerationModelAdapter}from './src/core/harness/generation-adapter.server.ts';console.log(JSON.stringify(await createGenerationModelAdapter().poll(process.argv[2],JSON.parse(readFileSync(process.argv[1],'utf8')),AbortSignal.timeout(5000),{projectId:process.argv[3],runId:process.argv[4],jobId:process.argv[5]})));`,snapshot,job.provider_id,f.project.id,f.run,job.id],{env:process.env,encoding:'utf8'}));
    assert.equal(observed.state,'uncertain');assert.match(observed.error,/original runtime/);assert.deepEqual(await events(),before);
  } finally { await writeFile(join(folder,'provider.mjs'),fixtureSource); }
  process.env.VH_MODEL_RECIPE_SETTING='changed';
  await assert.rejects(syncGeneration({wmTaskId:receipt.generation.id,effectId:receipt.generation.effectId}),/original runtime/);
  await f.h.step(f.run,adapters);assert.equal(f.h.jobs(f.run)[0].state,'uncertain');assert.deepEqual(await events(),before);
  process.env.VH_MODEL_RECIPE_SETTING='original';
  await (await getDb()).update(generationHistory).set({lastProviderSyncAt:new Date(0)}).where(eq(generationHistory.id,receipt.generation.id));
  f.h.requestReconciliation(f.run,['generation.model']);await finish(f.h,f.run);assert.equal(f.h.jobs(f.run)[0].state,'succeeded');
  assert.equal((await listProjectGenerations(f.project.id)).length,1);assert.equal((await events()).filter(event=>event.action==='check').at(-1)?.taskId,'original-task');
 }finally{process.env.VH_MODEL_RECIPE_SETTING='original';f.h.close();}
});

test('actual worker death leaves a traceable uncertain generation; retry and reconciliation cannot call the provider again',async()=>{
 const f=await setup([node('crash')]);
 try{
  const child=spawnSync(process.execPath,['--import','tsx','--input-type=module','-e',`import{DurableHarness}from './src/core/harness/durable.ts';import{createRuntimeAdapters}from './src/core/harness/adapters.ts';const h=new DurableHarness(process.argv[1]);await h.step(process.argv[2],createRuntimeAdapters());h.close();`,f.file,f.run],{env:process.env,encoding:'utf8',timeout:30_000});
  assert.equal(child.status,73,child.stderr);assert.equal(f.h.jobs(f.run)[0].state,'submitting');
  now=Math.max(now,Date.now())+400_000;await finish(f.h,f.run);assert.equal(f.h.jobs(f.run)[0].state,'uncertain');
  f.h.retry(f.run);f.h.requestReconciliation(f.run,['generation.model']);await finish(f.h,f.run);
  assert.equal(f.h.jobs(f.run)[0].state,'uncertain');assert.equal((await events()).filter(event=>event.prompt==='crash').length,1);
  assert.equal((await listProjectGenerations(f.project.id)).length,1);
 }finally{f.h.close();}
});

test('provider failure and concurrent submission keep one original intent and never authorize an automatic replacement',async()=>{
 const f=await setup([node('fail')]);
 try{await finish(f.h,f.run);assert.equal(f.h.jobs(f.run)[0].state,'uncertain');f.h.retry(f.run);f.h.requestReconciliation(f.run,['generation.model']);await finish(f.h,f.run);assert.equal((await events()).filter(event=>event.prompt==='fail').length,1);}finally{f.h.close();}
 const c=await setup([node('concurrent')]),adapter=createGenerationModelAdapter();
 try{
  const job=c.h.jobs(c.run)[0],context={key:job.idempotency_key,projectId:c.project.id,runId:c.run,jobId:job.id,dependencies:{},signal:AbortSignal.timeout(10_000)};
  const results=await Promise.allSettled([adapter.submit(c.plan.nodes[0].input,context),adapter.submit(c.plan.nodes[0].input,context)]);
  assert.ok(results.some(result=>result.status==='fulfilled'));assert.equal((await events()).filter(event=>event.prompt==='concurrent').length,1);
  assert.equal((await listProjectGenerations(c.project.id)).length,1);
 }finally{c.h.close();}
});

test('runtime changes, foreign/tampered references and identity bindings fail before provider execution',async()=>{
 const f=await setup([node('must-not-execute')]);
 try{const before=await events();process.env.VH_MODEL_RECIPE_SETTING='changed';await finish(f.h,f.run);assert.equal(f.h.jobs(f.run)[0].state,'failed');assert.deepEqual(await events(),before);assert.deepEqual(await listProjectGenerations(f.project.id),[]);}finally{process.env.VH_MODEL_RECIPE_SETTING='original';f.h.close();}
 const project=await createProject({name:'Reference fences'}),foreign=await createProject({name:'Foreign references'});
 const asset=await importLocalProjectAsset({projectId:project.id,filePath:video});
 const input={schemaVersion:1,mode:'analysis',modelId:'technical-video-review',prompt:'Inspect',references:[{assetId:asset.id,kind:'video',role:'source'}],parameters:{}};
 const plan={projectId:project.id,nodes:[{id:'analysis',operation:'generation.model',version:'1',input}]} as Plan;
 await assert.rejects(pinRuntimePlan({...plan,projectId:foreign.id}),/belonging/);
 const pinned=await pinRuntimePlan(plan);await assert.rejects(pinRuntimePlan(pinned),/already pinned/);
 for(const target of ['/modelId','/runtime/digest','/references/0/kind','/references'])await assert.rejects(pinRuntimePlan({projectId:project.id,nodes:[{...plan.nodes[0],bindings:[{target,node:'upstream',pointer:'/text'}]}]}),/bindings may change/);
 const original=await getProjectAssetById({projectId:project.id,assetId:asset.id});assert.ok(original);
 const file=resolveLocalProjectAssetPath({objectKey:original.objectKey}),bytes=await readFile(file);bytes[bytes.length-1]^=1;await writeFile(file,bytes);
 const h=new DurableHarness(join(directory,project.id+'.sqlite'),()=>now);
 try{const run=h.enqueue(pinned,'changed');await finish(h,run);assert.equal(h.jobs(run)[0].state,'failed');assert.deepEqual(await listProjectGenerations(project.id),[]);}finally{h.close();}
});


test('selected gallery output is reused and corrupted retained bytes cannot silently succeed or trigger regeneration',async()=>{
 const selected=node('gallery');selected.input={...(selected.input as Record<string,Json>),outputIndex:1};
 const f=await setup([selected]);
 try{
  await f.h.step(f.run,adapters);await f.h.step(f.run,adapters);
  const job=f.h.jobs(f.run)[0];assert.equal(job.state,'succeeded');const output=JSON.parse(job.output_json!);assert.equal(output.width,80);
  assert.equal(new Set((await listProjectAssets({projectId:f.project.id})).map((asset:{id:string})=>asset.id)).size,2);
  const asset=await getProjectAssetById({projectId:f.project.id,assetId:output.assetId});assert.ok(asset);
  const file=resolveLocalProjectAssetPath({objectKey:asset.objectKey}),original=await readFile(file),changed=Buffer.from(original);changed[changed.length-1]^=1;await writeFile(file,changed);
  const adapter=createGenerationModelAdapter(),context={projectId:f.project.id,runId:f.run,jobId:job.id};
  assert.equal((await adapter.poll(job.provider_id!,f.plan.nodes[0].input,AbortSignal.timeout(5000),context)).state,'uncertain');
  await writeFile(file,original);assert.equal((await adapter.poll(job.provider_id!,f.plan.nodes[0].input,AbortSignal.timeout(5000),context)).state,'succeeded');
  assert.equal((await events()).filter(event=>event.prompt==='gallery').length,1);
 }finally{f.h.close();}
});

test('cancellation after submission remains unconfirmed and never grants another provider request',async()=>{
 const f=await setup([node('queued')]);
 try{
  await f.h.step(f.run,adapters);const before=await events();f.h.cancel(f.run);await f.h.step(f.run,adapters);
  assert.equal(f.h.jobs(f.run)[0].state,'uncertain');assert.match(f.h.jobs(f.run)[0].error!,/cancellation unsupported/);
  f.h.retry(f.run);await finish(f.h,f.run);assert.deepEqual(await events(),before);
 }finally{f.h.close();}
});

test('an independently authored model recipe installs, compiles and executes through the existing worker adapter', async () => {
 const { listModelRecipeModels, buildModelRecipe } = await import('./model-recipe.server');
 const { inspectRecipe, installRecipe } = await import('./recipe-library');
 const chosen = listModelRecipeModels().find(model => model.id === 'procedural-gradient')!;
 const recipe = buildModelRecipe({schemaVersion:1,id:'authored-gradient',version:'1.0.0',title:'Independent gradient',description:'General reusable model',author:'External author',license:'MIT',category:'creation',tags:['general'],modelId:chosen.id,referenceCounts:{image:0,video:0,audio:0}}, chosen.digest);
 const review = await inspectRecipe(recipe); await installRecipe(JSON.parse(JSON.stringify(recipe)), review.digest);
 const project = await createProject({name:'Authored model run'});
 const h = new DurableHarness(join(directory, project.id+'.sqlite'),()=>now);
 try {
  const plan = await pinRuntimePlan(compileRecipe(recipe,{prompt:'Amber composition','aspect-ratio':'9:16'},project.id));
  const run = h.enqueue(plan,'authored'); await finish(h,run);
  assert.equal(h.jobs(run)[0].state,'succeeded'); assert.equal(h.jobs(run)[0].attempts,1);
  const output=JSON.parse(h.jobs(run)[0].output_json!); assert.ok(output.assetId); assert.equal(output.kind,'image');
  assert.equal((await listProjectGenerations(project.id)).length,1);
  assert.equal((await attachRunResult(h,project.id,run,h.jobs(run)[0].id,0)).ok,true);
  assert.equal((await loadProjectTimeline(project.id))!.document.tracks[0].clips[0].assetId,output.assetId);
 } finally {h.close();}
});

test('analysis measurements drive a model option after restart without validating or executing its placeholder', async () => {
 const project=await createProject({name:'Measured audio length'}),asset=await importLocalProjectAsset({projectId:project.id,filePath:video});
 const recipe=JSON.parse(await readFile('../../examples/provider-recipes/measured-calibration.json','utf8'));
 const {inspectRecipe,installRecipe}=await import('./recipe-library');
 const review=await inspectRecipe(recipe);assert.equal(review.modelRequirements?.status,'checked');
 await installRecipe(recipe,review.digest);
 const raw=compileRecipe(recipe,{source:asset.id,frequency:440},project.id);
 const original=JSON.stringify(raw),pinned=await pinRuntimePlan(raw),file=join(directory,project.id+'.sqlite');
 assert.equal(JSON.stringify(raw),original);let h=new DurableHarness(file,()=>now);
 try{
  const run=h.enqueue(pinned,'measured-options');
  for(let i=0;i<8 && h.jobs(run)[0].state!=='succeeded';i++){now+=25000;await h.step(run,adapters);}
  assert.equal(h.jobs(run)[0].state,'succeeded');assert.equal((await listProjectGenerations(project.id)).length,1);
  h.close();h=new DurableHarness(file,()=>now);await finish(h,run);
  const sound=h.jobs(run).find(job=>job.node_id==='sound')!;assert.equal(sound.state,'succeeded');assert.equal(sound.attempts,1);
  const input=JSON.parse(sound.execution_input_json!);assert.equal(input.parameters.provider_options.seconds,.5);assert.equal(input.parameters.provider_options.frequency,440);
  assert.equal(JSON.parse(sound.output_json!).durationMs,500);assert.equal((await listProjectGenerations(project.id)).length,2);
  const edit=h.jobs(run).find(job=>job.node_id==='edit')!;assert.equal(edit.state,'succeeded');
  assert.equal((await attachRunResult(h,project.id,run,edit.id,0)).ok,true);
  const timeline=await loadProjectTimeline(project.id);assert.ok(timeline);
  assert.deepEqual(timeline.document.tracks.flatMap(track=>track.clips).map(clip=>[clip.sourceType,clip.duration]),[['video',.5],['audio',.5]]);
  h.close();h=new DurableHarness(file,()=>now);
  assert.equal(h.enqueue(await pinRuntimePlan(raw),'measured-options'),run);await finish(h,run);assert.equal((await listProjectGenerations(project.id)).length,2);
  assert.deepEqual(await loadProjectTimeline(project.id),timeline);assert.equal(h.jobs(run).every(job=>job.attempts===1),true);
 }finally{h.close();}
});

test('an invalid resolved option fails before reserving an intent or calling the downstream model',async()=>{
 const project=await createProject({name:'Invalid measured option'}),asset=await importLocalProjectAsset({projectId:project.id,filePath:video});
 const raw: Plan={projectId:project.id,nodes:[
  {id:'measure',operation:'generation.model',version:'1',input:{schemaVersion:1,mode:'analysis',modelId:'technical-video-review',prompt:'Measure',references:[{assetId:asset.id,kind:'video'}],parameters:{}}},
  {id:'sound',operation:'generation.model',version:'1',dependsOn:['measure'],input:{schemaVersion:1,mode:'audio',modelId:'procedural-sound',prompt:'Reject string length',parameters:{provider_options:{seconds:0}}},bindings:[{node:'measure',pointer:'/text',target:'/parameters/provider_options/seconds'}]},
 ]};
 const h=new DurableHarness(join(directory,project.id+'.sqlite'),()=>now);
 try{
  const run=h.enqueue(await pinRuntimePlan(raw),'invalid-options');await finish(h,run);
  const sound=h.jobs(run).find(job=>job.node_id==='sound')!;assert.equal(sound.state,'failed');assert.match(sound.error!,/Length|option/);
  assert.equal((await listProjectGenerations(project.id)).length,1);
  assert.equal(await findGenerationIntentReceipt({projectId:project.id,intentId:modelGenerationIntentId(project.id,sound.idempotency_key)}),null);
 }finally{h.close();}
});

test('an unrelated upstream binding cannot defer fixed invalid model settings or reference counts',async()=>{
 const project=await createProject({name:'Fixed settings before enqueue'});
 const make=(parameters:Json,mode='image',modelId='procedural-gradient'):Plan=>({projectId:project.id,nodes:[{...node('upstream','procedural-gradient'),id:'prior'},{id:'next',operation:'generation.model',version:'1',dependsOn:['prior'],input:{schemaVersion:1,mode,modelId,prompt:'',parameters},bindings:[{node:'prior',pointer:'/text',target:'/prompt'}]}]});
 await assert.rejects(pinRuntimePlan(make({aspect_ratio:'2:3'})),/aspect_ratio|aspect ratio/);
 await assert.rejects(pinRuntimePlan(make({},'analysis','technical-video-review')),/references|source/);
 assert.equal((await listProjectGenerations(project.id)).length,0);
});


test('a whole option object is bound without coercion and checked before downstream intent allocation',async()=>{
 const cases:Record<string,Json>[]=[{seconds:.25,frequency:660},{seconds:'0.25',frequency:660},{seconds:.25,unknown:true}];
 for(const options of cases){
  const project=await createProject({name:'Independent configuration object'});
  const raw:Plan={projectId:project.id,nodes:[
   {id:'config',operation:'test.options',version:'1',input:{}},
   {id:'sound',operation:'generation.model',version:'1',dependsOn:['config'],input:{schemaVersion:1,mode:'audio',modelId:'procedural-sound',prompt:'Configured tone',parameters:{provider_options:null}},bindings:[{node:'config',pointer:'/options',target:'/parameters/provider_options'}]},
  ]};
  // An isolated upstream adapter supplies typed data; the downstream audio provider is real.
  const config:Adapter={recovery:'replay',async submit(){return{id:'config'};},async poll(){return{state:'succeeded',output:{options}};}};
  const h=new DurableHarness(join(directory,project.id+'.sqlite'),()=>now);
  try{
   const run=h.enqueue(await pinRuntimePlan(raw),'whole-map');await finish(h,run,{...adapters,'test.options':config});
   const job=h.jobs(run).find(job=>job.node_id==='sound')!;
   assert.deepEqual(JSON.parse(job.execution_input_json!).parameters.provider_options,options);
   const valid=typeof options.seconds==='number'&&!('unknown' in options);
   assert.equal(job.state,valid?'succeeded':'failed');assert.equal((await listProjectGenerations(project.id)).length,valid?1:0);
   if(valid)assert.equal(JSON.parse(job.output_json!).durationMs,250);
   else assert.equal(await findGenerationIntentReceipt({projectId:project.id,intentId:modelGenerationIntentId(project.id,job.idempotency_key)}),null);
  }finally{h.close();}
 }
});
