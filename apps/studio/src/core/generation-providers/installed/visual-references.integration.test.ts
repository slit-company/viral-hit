import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, cp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { providerManifestSchema } from './manifest';
import { validateInstalledVisualInput } from './visual-input';
import { InstalledProviderRuntime, InstalledProviderAdapter } from './runtime.server';
import type { EffectRecord } from '@/core/adapters/base-adapter';

const directory=await mkdtemp(join(tmpdir(),'vh-visual-references-'));
process.env.VIRAL_HIT_DATA_DIR=directory;
for(const key of ['VIRAL_HIT_PROVIDERS_DIR','VIRAL_HIT_RUNTIME_PACKAGES_DIR','VIRAL_HIT_HARNESS_DB'])delete process.env[key];
execFileSync('pnpm',['exec','drizzle-kit','push','--force'],{env:process.env,stdio:'pipe'});
after(()=>rm(directory,{recursive:true,force:true}));
const providers=join(directory,'providers');
await cp(resolve('../../examples/providers/visual-conform'),join(providers,'visual-conform'),{recursive:true});
await cp(resolve('../../examples/providers/procedural-images'),join(providers,'procedural-images'),{recursive:true});
const manifest=providerManifestSchema.parse(JSON.parse(await readFile(join(providers,'visual-conform/provider.json'),'utf8')));
const {installGenerationProviders}=await import('./install.server');
assert.deepEqual(installGenerationProviders(providers).problems,[]);
const {createProject}=await import('@/core/projects/projects');
const {importLocalProjectAsset}=await import('@/core/projects/import-local-asset');
const {resolveLocalProjectAssetPath}=await import('@/core/projects/local-project-assets');
const {getProjectAssetById}=await import('@/core/workspace-lib/assets/user-assets');
const {listProjectGenerations}=await import('@/core/effects/project-generations');
const {getGenerationModelDescriptor}=await import('../model-catalog');
const {getWorkspaceMediaSchema}=await import('@/core/effects/workspace-media');
const {preflightAssetFirstGeneration,submitAssetFirstGeneration}=await import('../submit');
const ffmpeg=process.env.VIRAL_HIT_FFMPEG||'ffmpeg',ffprobe=process.env.VIRAL_HIT_FFPROBE||'ffprobe';
const files={image:join(directory,'image.png'),video:join(directory,'video.mp4'),audio:join(directory,'audio.wav')};
execFileSync(ffmpeg,['-v','error','-f','lavfi','-i','color=c=blue:s=80x80','-frames:v','1',files.image]);
execFileSync(ffmpeg,['-v','error','-f','lavfi','-i','color=c=orange:s=320x180:r=24:d=2','-c:v','libx264','-pix_fmt','yuv420p',files.video]);
execFileSync(ffmpeg,['-v','error','-f','lavfi','-i','sine=frequency=440:duration=2','-ar','24000','-c:a','pcm_s16le',files.audio]);
async function setup(){
 const project=await createProject({name:'Independent visual sources'});
 const assets=await Promise.all(Object.values(files).map(filePath=>importLocalProjectAsset({projectId:project.id,filePath})));
 const generation={version:2 as const,projectId:project.id,mode:'video' as const,modelId:'visual-cut',prompt:'Reference video, badge and soundtrack',parameters:{aspect_ratio:'16:9',provider_options:{start:0,seconds:1}},references:assets.map(asset=>({assetId:asset.id,role:'reference' as const}))};
 return{project,assets,generation};
}
async function output(projectId:string){const [item]=await listProjectGenerations(projectId);const asset=await getProjectAssetById({projectId,assetId:item.resultUrl!.split('/').at(-1)!});assert.ok(asset);return{item,asset,path:resolveLocalProjectAssetPath({objectKey:asset.objectKey})};}
const pixel=(path:string,x:number,y:number)=>[...execFileSync(ffmpeg,['-v','error','-i',path,'-vf',`crop=8:8:${x}:${y},scale=1:1`,'-frames:v','1','-pix_fmt','rgb24','-f','rawvideo','-'])];

test('visual declarations retain legacy manifests and reject conflicting contracts before module entry',async()=>{
 const descriptor=getGenerationModelDescriptor('visual-cut');assert.deepEqual(descriptor?.referenceInputs,manifest.models[1].referenceInputs);
 assert.deepEqual(['image','video','audio'].map(kind=>getWorkspaceMediaSchema('visual-cut')![kind as 'image'|'video'|'audio'].max),[1,1,1]);
 const legacy=providerManifestSchema.parse(JSON.parse(await readFile('../../examples/providers/procedural-images/provider.json','utf8')));
 assert.equal(Object.hasOwn(legacy.models[0],'referenceInputs'),false);
 for(const change of [{maxReferenceImages:1},{requiresImageInput:true},{kind:'analysis',aspectRatios:[]}])assert.throws(()=>providerManifestSchema.parse({...manifest,models:[{...manifest.models[0],...change}]}));
 const model=manifest.models[1];
 for(const input of [{prompt:'x'},{prompt:'x',video_url:'https://example.com/v'},{prompt:'x',video_urls:['https://example.com/v','https://example.com/w']},{prompt:'x',video_urls:['https://example.com/v'],audio_urls:['https://example.com/v']},{prompt:'x',video_urls:['https://example.com/v'],aspect_ratio:'21:9'}])assert.throws(()=>validateInstalledVisualInput(input,model));
 const runtime=new InstalledProviderRuntime(manifest,'throw Error("MUST_NOT_IMPORT")');
 assert.throws(()=>new InstalledProviderAdapter({linkName:'visual-cut',type:1} as EffectRecord,runtime).createGeneration({prompt:'x'}),error=>!String(error).includes('MUST_NOT_IMPORT'));
});

test('independent video model consumes all three kinds and produces actual overlay pixels and audible output',async()=>{
 const{project,assets,generation}=await setup();
 const result=await submitAssetFirstGeneration({generation,origin:'mcp'});assert.equal(result.body.status,'succeeded',JSON.stringify(result));
 const out=await output(project.id);assert.equal(out.item.mediaType,'video');assert.deepEqual([out.item.referenceImages.length,out.item.referenceVideos.length,out.item.referenceAudios.length],[1,1,1]);
 const probe=JSON.parse(execFileSync(ffprobe,['-v','error','-show_format','-show_streams','-of','json',out.path],{encoding:'utf8'}));
 assert.ok(Math.abs(Number(probe.format.duration)-1)<.1);assert.ok(probe.streams.some((s:{codec_type:string})=>s.codec_type==='audio'));
 const badge=pixel(out.path,20,20),center=pixel(out.path,156,86);assert.ok(badge[2]>180&&badge[0]<30);assert.ok(center[0]>200&&center[1]>100&&center[2]<30);
 const pcm=execFileSync(ffmpeg,['-v','error','-i',out.path,'-t','0.5','-vn','-ac','1','-ar','8000','-f','f32le','-']);let power=0;for(let i=0;i<pcm.length;i+=4)power+=pcm.readFloatLE(i)**2;assert.ok(Math.sqrt(power/(pcm.length/4))>.02);
 for(const[index,asset]of assets.entries()){const stored=await getProjectAssetById({projectId:project.id,assetId:asset.id});assert.ok(stored);assert.deepEqual(await readFile(resolveLocalProjectAssetPath({objectKey:stored.objectKey})),await readFile(Object.values(files)[index]));}
});

test('video-to-image output and upstream video-to-image recipe use the same reference contract',async()=>{
 const{project,assets,generation}=await setup();
 const {DurableHarness}=await import('@/core/harness/durable');const{pinRuntimePlan}=await import('@/core/harness/runtime-plan');const{createRuntimeAdapters}=await import('@/core/harness/adapters');
 const plan=await pinRuntimePlan({projectId:project.id,nodes:[{id:'cut',operation:'generation.model',version:'1',input:{schemaVersion:1,mode:'video',modelId:'visual-cut',prompt:'Crop video',parameters:generation.parameters,references:[{assetId:assets[1].id,kind:'video'}]}},{id:'frame',operation:'generation.model',version:'1',dependsOn:['cut'],input:{schemaVersion:1,mode:'image',modelId:'visual-frame',prompt:'Extract original frame',parameters:{aspect_ratio:'1:1',provider_options:{start:0}},references:[{assetId:'upstream',kind:'video'}]},bindings:[{node:'cut',pointer:'/assetId',target:'/references/0/assetId'}]}]});
 let now=Date.now();const h=new DurableHarness(join(directory,'harness.sqlite'),()=>now);
 try{const run=h.enqueue(plan,'visual-reference-chain');for(let i=0;i<10;i++){now+=25000;await h.step(run,createRuntimeAdapters());}
 assert.deepEqual(h.jobs(run).map(job=>job.state),['succeeded','succeeded']);const frame=JSON.parse(h.jobs(run)[1].output_json!);assert.equal(frame.kind,'image');assert.equal(frame.width,240);assert.equal(frame.height,240);
 }finally{h.close();}
});

test('missing, foreign, forbidden and tampered references fail before creating generation history',async()=>{
 const{project,assets,generation}=await setup();
 await assert.rejects(preflightAssetFirstGeneration({...generation,references:[]}),/requires/);
 await assert.rejects(preflightAssetFirstGeneration({...generation,mode:'image',modelId:'visual-frame',parameters:{aspect_ratio:'1:1'}}),/requires/);
 const other=await createProject({name:'Foreign project'});await assert.rejects(preflightAssetFirstGeneration({...generation,projectId:other.id}),/local project media/);
 const asset=await getProjectAssetById({projectId:project.id,assetId:assets[1].id});assert.ok(asset);const path=resolveLocalProjectAssetPath({objectKey:asset.objectKey});const original=await readFile(path),changed=Buffer.from(original);changed[changed.length-1]^=1;await writeFile(path,changed);
 await assert.rejects(preflightAssetFirstGeneration(generation),/content changed/);await writeFile(path,original);
 assert.deepEqual(await listProjectGenerations(project.id),[]);
});
