import { selectStudioModel } from './studio-tools';
import { test, expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
const headers={'x-viral-hit-workspace-request':'1'},evidence='../../research/evidence/visual-model-references';
async function media(){
 await mkdir(evidence,{recursive:true});const ffmpeg=process.env.VIRAL_HIT_FFMPEG||'ffmpeg';
 const files={image:evidence+'/badge.png',video:evidence+'/source.mp4',audio:evidence+'/sound.wav'};
 execFileSync(ffmpeg,['-y','-v','error','-f','lavfi','-i','color=c=blue:s=80x80','-frames:v','1',files.image]);
 execFileSync(ffmpeg,['-y','-v','error','-f','lavfi','-i','color=c=orange:s=320x180:r=24:d=2','-c:v','libx264','-pix_fmt','yuv420p',files.video]);
 execFileSync(ffmpeg,['-y','-v','error','-f','lavfi','-i','sine=frequency=440:duration=2','-ar','24000','-c:a','pcm_s16le',files.audio]);return files;
}
const choose = selectStudioModel;

test('independent visual models accept mixed sources and recover every original reference through reload and history',async({page,request})=>{
 const files=await media(),projectId=(await(await request.post('/api/app/projects',{headers,data:{name:'Visual source studio'}})).json()).id;
 let uploads=0;const errors:string[]=[],submitted:Array<{references:Array<{assetId:string}>}>=[];
 page.on('pageerror',error=>errors.push(error.message));page.on('request',req=>{if(req.method()==='POST'&&req.url().endsWith(`/projects/${projectId}/assets`))uploads++;if(req.url().endsWith('/api/effects/generate'))submitted.push(req.postDataJSON().generation);});
 await page.goto(`/studio/${projectId}?target=video&model=visual-cut`);await choose(page,'Video with image and audio');
 await page.locator('[data-vh-composer] textarea').fill('Format source with a badge and soundtrack');
 await expect(page.getByRole('button',{name:'만들기',exact:true})).toBeDisabled();
 await page.getByLabel('Visual reference files',{exact:true}).setInputFiles(Object.values(files));
 await expect(page.getByRole('button',{name:'Visual sources',exact:true})).toHaveText('Sources · 3');expect(uploads).toBe(3);
 await page.getByRole('button',{name:'Visual sources',exact:true}).click();
 for(const name of ['badge.png','source.mp4','sound.wav'])await expect(page.getByRole('button',{name:new RegExp('^Remove source '+name)})).toBeVisible();
 await page.screenshot({path:evidence+'/sources-desktop.png',animations:'disabled'});
 await page.setViewportSize({width:390,height:844});await expect(page.getByRole('button',{name:'Done',exact:true})).toBeInViewport();
 await page.screenshot({path:evidence+'/sources-mobile.png',animations:'disabled'});await page.getByRole('button',{name:'Done',exact:true}).click();
 await choose(page,'Seedance 2');
 await expect(page.getByRole('button',{name:'Visual sources',exact:true})).toHaveText('Sources · 3');
 await choose(page,'Video with image and audio');await page.reload();await choose(page,'Video with image and audio');
 await expect(page.getByRole('button',{name:'Visual sources',exact:true})).toHaveText('Sources · 3');
 await page.locator('[data-vh-composer] textarea').fill('Format source with a badge and soundtrack');
 await page.getByRole('button',{name:'만들기',exact:true}).scrollIntoViewIfNeeded();await expect(page.getByRole('button',{name:'만들기',exact:true})).toBeInViewport();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:evidence+'/composer-mobile.png',animations:'disabled'});
 await page.getByRole('button',{name:'만들기',exact:true}).click();
 await expect.poll(async()=>(await(await request.get(`/api/app/projects/${projectId}/generations`)).json()).items[0]?.status).toBe('succeeded');
 await page.locator('article').first().getByRole('button').nth(1).click();
 const video=page.getByRole('dialog').locator('video').first();await expect.poll(()=>video.evaluate((el:HTMLVideoElement)=>el.readyState)).toBeGreaterThanOrEqual(2);
 await video.evaluate((el:HTMLVideoElement)=>el.play());await expect.poll(()=>video.evaluate((el:HTMLVideoElement)=>el.currentTime)).toBeGreaterThan(.05);await video.evaluate((el:HTMLVideoElement)=>el.pause());
 await expect(page.getByLabel('Audio reference',{exact:true})).toHaveCount(1);await page.keyboard.press('Escape');
 await page.evaluate(id=>sessionStorage.removeItem(`viral-hit:studio-visual-sources:${id}`),projectId);await page.reload();
 await expect(page.getByRole('button',{name:'Visual sources',exact:true})).toHaveText('Sources · 0');
 await page.locator('article').first().getByRole('button').first().click();await expect(page.getByRole('button',{name:'Visual sources',exact:true})).toHaveText('Sources · 3');
 await page.getByRole('button',{name:'만들기',exact:true}).click();
 await expect.poll(async()=>(await(await request.get(`/api/app/projects/${projectId}/generations`)).json()).items.length).toBe(2);
 expect(uploads).toBe(3);expect(submitted).toHaveLength(2);expect(submitted[1].references).toEqual(submitted[0].references);
 expect(errors).toEqual([]);
});

test('video-to-image source requirements reject excess selection before uploading and preserve incompatible sources',async({page,request})=>{
 const files=await media(),projectId=(await(await request.post('/api/app/projects',{headers,data:{name:'Visual frame studio'}})).json()).id;let uploads=0;
 page.on('request',req=>{if(req.method()==='POST'&&req.url().endsWith(`/projects/${projectId}/assets`))uploads++;});
 await page.goto(`/studio/${projectId}?target=image&model=visual-frame`);await choose(page,'Frame from video');
 await page.locator('[data-vh-composer] textarea').fill('Extract a source frame');
 await page.getByLabel('Visual reference files',{exact:true}).setInputFiles([files.video,files.video]);await expect(page.getByRole('alert')).toContainText('at most 1 video');expect(uploads).toBe(0);
 await page.getByLabel('Visual reference files',{exact:true}).setInputFiles(files.video);await expect(page.getByRole('button',{name:'Visual sources',exact:true})).toHaveText('Sources · 1');
 await choose(page,'Gradient (instant)');await expect(page.getByRole('button',{name:'만들기',exact:true})).toBeDisabled();await expect(page.getByRole('status')).toContainText('Selected sources do not match');
 await choose(page,'Frame from video');await page.getByRole('button',{name:'만들기',exact:true}).click();
 await expect.poll(async()=>(await(await request.get(`/api/app/projects/${projectId}/generations`)).json()).items[0]?.status).toBe('succeeded');
 await expect(page.locator('article img').first()).toBeVisible();expect(uploads).toBe(1);
});
