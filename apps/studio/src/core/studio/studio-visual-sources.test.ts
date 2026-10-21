import test from 'node:test';
import assert from 'node:assert/strict';
import { appendVisualSource, restoreVisualSources, visualSourceReferences, visualSourcesSchema } from './studio-visual-sources';
import type { WorkspaceModelOption } from '../effects/workspace-models';
import type { ProjectGenerationItem } from '../effects/project-generations';
const references={image:{min:0,max:1},video:{min:1,max:1},audio:{min:0,max:1}};
const model={id:'independent-cut',name:'Independent cut',available:true,referenceInputs:references} as WorkspaceModelOption;
const video={id:'video',type:'video' as const,filename:'source.mp4',publicUrl:'/api/app/projects/project/assets/video'};
const audio={...video,id:'audio',type:'audio' as const,filename:'sound.wav',publicUrl:'/api/app/projects/project/assets/audio'};
test('visual source selection retains IDs, enforces counts and does not silently coerce a different model',()=>{
 const draft=appendVisualSource(appendVisualSource({sources:[]},video,model),audio,model);
 assert.deepEqual(visualSourceReferences(draft.sources,model),[{assetId:'video',role:'reference'},{assetId:'audio',role:'audio_track'}]);
 assert.deepEqual(appendVisualSource(draft,audio,model),draft);
 assert.throws(()=>appendVisualSource(draft,{...audio,id:'extra'},model),/at most/);
 assert.throws(()=>visualSourceReferences(draft.sources,{...model,referenceInputs:{...references,audio:{min:0,max:0}}}),/audio references/);
 assert.equal(draft.sources.length,2);
 assert.throws(()=>visualSourceReferences([],model),/video references/);
 assert.throws(()=>visualSourceReferences(draft.sources,{...model,available:false}),/available/);
 assert.deepEqual(visualSourcesSchema.parse(JSON.parse(JSON.stringify(draft))),draft);
});
test('all visual history reference kinds recover exact local IDs outside the library window',()=>{
 const item={referenceImages:[],referenceVideos:[video.publicUrl],referenceAudios:[audio.publicUrl]} satisfies Pick<ProjectGenerationItem, 'referenceImages' | 'referenceVideos' | 'referenceAudios'>;
 assert.deepEqual(restoreVisualSources('project',item,[]).sources.map(source=>[source.id,source.type]),[['video','video'],['audio','audio']]);
 assert.throws(()=>restoreVisualSources('foreign',item,[]),/another project/);
});
