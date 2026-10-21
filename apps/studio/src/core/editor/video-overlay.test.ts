import { readFileSync } from 'node:fs';
import { compileRecipe } from '../harness/recipes';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyEditorOperations } from '../commands/editor-commands';
import { editorOperationSchema } from '../commands/schema';
import { appendSequence, sequenceSchema } from './sequence';
import { createTimelineDocument, findTimelineClip, normalizeTimelineDocument, splitTimelineClip, getTimelineClipSource } from './timeline-document';
import { overlayTransformAt } from './overlay-motion';

const source = { type:'add_overlay' as const, clipId:'pip', assetId:'video', sourceUrl:'/video.mp4', name:'Demo', sourceType:'video' as const, sourceDuration:4, inPoint:1, startTime:2, duration:2 };
test('video overlays retain source time, motion and audio edits across split and reload without changing the original',()=>{
 const empty=createTimelineDocument({projectId:'p',name:'General picture in picture'});
 let doc=applyEditorOperations(empty,[editorOperationSchema.parse(source)]).document;
 doc=applyEditorOperations(doc,[{type:'set_overlay_motion',clipId:'pip',motion:{version:1,keyframes:[
  {id:'a',time:1,x:.2,y:.4,width:.3,rotation:0,opacity:1,easing:'linear'},
  {id:'b',time:3,x:.8,y:.4,width:.3,rotation:20,opacity:.5,easing:'linear'},
 ]}},{type:'update_audio',clipId:'pip',patch:{volume:.3}}]).document;
 const before=normalizeTimelineDocument(JSON.parse(JSON.stringify(doc))),split=splitTimelineClip(before,'pip',2,'right');
 const right=findTimelineClip(split,'right')!;
 assert.equal(right.sourceType,'video');assert.equal(right.inPoint,2);assert.equal(right.volume,.3);
 assert.deepEqual(overlayTransformAt(right,3.5),overlayTransformAt(findTimelineClip(before,'pip')!,3.5));
 assert.deepEqual(getTimelineClipSource(right),{...getTimelineClipSource(findTimelineClip(before,'pip')!),inPoint:2});
 assert.equal(findTimelineClip(before,'pip')!.duration,2);
 assert.throws(()=>editorOperationSchema.parse({...source,sourceDuration:2}),/fit/);
 assert.throws(()=>editorOperationSchema.parse({...source,sourceDuration:undefined}),/fit/);
 assert.throws(()=>editorOperationSchema.parse({...source,sourceType:'audio'}));
 assert.throws(()=>applyEditorOperations(before,[{type:'replace_overlay_asset',clipId:'pip',assetId:'image',sourceUrl:'/image.png',name:'Different kind'}]));
});
test('independent sequences can compose moving layers and enforce actual media duration and kind',()=>{
 const raw={schemaVersion:1,title:'Demo over presentation',assets:{stage:{assetId:'stage',kind:'image'},demo:{assetId:'demo',kind:'video'}},tracks:[
  {id:'stage',name:'Presentation',kind:'video',clips:[{id:'stage',type:'media',source:'stage',startTime:0,duration:4}]},
  {id:'demo',name:'Demo',kind:'overlay',clips:[{id:'demo',type:'media',source:'demo',startTime:1,inPoint:1,duration:2,volume:.4,overlay:{x:.75,y:.7,width:.35,rotation:0,opacity:1}}]},
 ]};
 const sequence=sequenceSchema.parse(raw),media={stage:{assetId:'stage',kind:'image' as const,publicUrl:'/stage.png',name:'Stage',duration:null},demo:{assetId:'demo',kind:'video' as const,publicUrl:'/demo.mp4',name:'Demo',duration:3}};
 const document=appendSequence(createTimelineDocument({projectId:'p',name:'P'}),sequence,media,'author');
 const clip=document.tracks.flatMap(t=>t.clips).find(c=>c.sourceType==='video')!;
 assert.equal(clip.inPoint,1);assert.equal(clip.outPoint,3);assert.equal(clip.overlay!.width,.35);assert.equal(clip.volume,.4);
 assert.throws(()=>appendSequence(document,sequence,{...media,demo:{...media.demo,duration:2}},'short'),/exceeds/);
 assert.throws(()=>sequenceSchema.parse({...raw,assets:{...raw.assets,demo:{assetId:'demo',kind:'audio'}}}),/kind/);
});


test('the general picture-in-picture recipe exposes editable source, timing, width and audio controls',()=>{
 const recipe=JSON.parse(readFileSync('../../recipes/picture-in-picture.json','utf8'));
 const plan=compileRecipe(recipe,{background:'background',inset:'demo',duration:2,'inset-start':1,width:.4,volume:.2},'project');
 const sequence=sequenceSchema.parse(plan.nodes[0].input),clip=sequence.tracks[1].clips[0];
 assert.equal(clip.type,'media');if(clip.type!=='media')return;
 assert.equal(clip.inPoint,1);assert.equal(clip.duration,2);assert.equal(clip.overlay!.width,.4);assert.equal(clip.volume,.2);
});
