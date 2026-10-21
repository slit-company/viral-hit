import {test,expect,type APIRequestContext} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
import type {TimelineDocument} from '../../src/core/editor/timeline-document';
const headers={'x-viral-hit-workspace-request':'1'},ffmpeg=process.env.VIRAL_HIT_FFMPEG||'ffmpeg';
async function mcp(request:APIRequestContext,name:string,args:Record<string,unknown>){
 const response=await request.post('http://127.0.0.1:3043/mcp',{headers:{authorization:'Bearer e2e-local-only',accept:'application/json, text/event-stream'},data:{jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}}});
 const text=await response.text(),rpc=JSON.parse(text.startsWith('{')?text:text.split('\n').find(l=>l.startsWith('data: '))!.slice(6));
 expect(rpc.result?.isError,JSON.stringify(rpc)).not.toBe(true);return rpc.result;
}
test('video layers import, seek, animate, retain audio and export through browser and server',async({page,request})=>{
 test.setTimeout(180000);page.setDefaultTimeout(15000);
 const id=(await(await request.post('/api/app/projects',{headers,data:{name:'Picture in picture · Edit the demo'}})).json()).id;
 const base=execFileSync(ffmpeg,['-v','error','-f','lavfi','-i','color=black:s=640x360','-frames:v','1','-f','image2pipe','-vcodec','png','-']);
 const background=(await(await request.post(`/api/app/projects/${id}/assets`,{headers,multipart:{file:{name:'Stage.png',mimeType:'image/png',buffer:base}}})).json()).asset;
 await mcp(request,'viral_hit_editor_edit',{projectId:id,operations:[{type:'add_clip',clipId:'stage',assetId:background.id,name:'Stage',sourceType:'image',sourceDuration:4}]});
 const file='test-results/overlay-source.mp4';
 execFileSync(ffmpeg,['-v','error','-y','-f','lavfi','-i','color=red:s=160x90:r=30:d=1[a];color=blue:s=160x90:r=30:d=1[b];color=lime:s=160x90:r=30:d=1[c];[a][b][c]concat=n=3:v=1:a=0','-f','lavfi','-i','sine=frequency=660:duration=3','-vf','scale=out_color_matrix=bt709','-c:v','libx264','-pix_fmt','yuv420p','-colorspace','bt709','-color_primaries','bt709','-color_trc','bt709','-c:a','aac','-shortest',file]);
 await page.goto(`/editor/${id}`);await page.locator('input[accept="image/*,video/*"]').setInputFiles(file);
 const read=async()=>(await(await request.get(`/api/app/projects/${id}/timeline`)).json()).timeline.document as TimelineDocument;
 await expect.poll(async()=>(await read()).tracks.flatMap(t=>t.clips).filter(c=>c.overlay).length).toBe(1);
 const overlay=(await read()).tracks.flatMap(t=>t.clips).find(c=>c.overlay)!;
 expect(overlay.sourceType).toBe('video');expect(overlay.sourceDuration).toBe(3);
 await mcp(request,'viral_hit_editor_edit',{projectId:id,operations:[{type:'trim_clip',clipId:overlay.id,inPoint:1,outPoint:3},{type:'update_overlay',clipId:overlay.id,patch:{fadeIn:0,fadeOut:0}},{type:'set_overlay_motion',clipId:overlay.id,motion:{version:1,keyframes:[
  {id:'start',time:1,x:.25,y:.5,width:.4,rotation:0,opacity:1,easing:'linear'},
  {id:'finish',time:3,x:.75,y:.5,width:.4,rotation:0,opacity:1,easing:'linear'},
 ]}}]});
 await page.reload();await page.getByRole('button',{name:'overlay-source.mp4 2.00s',exact:true}).click();
 const video=page.getByRole('button',{name:'Move video overlay: overlay-source.mp4',exact:true}).locator('video');
 await expect.poll(()=>video.evaluate(el=>(el as HTMLVideoElement).currentTime)).toBeCloseTo(1,2);
 await page.getByRole('button',{name:'Play selection',exact:true}).click();
 await expect.poll(()=>video.evaluate(el=>(el as HTMLVideoElement).currentTime)).toBeGreaterThan(1.15);
 await page.getByRole('button',{name:'Pause',exact:true}).click();await expect.poll(()=>video.evaluate(el=>(el as HTMLVideoElement).paused)).toBe(true);
 await page.getByRole('button',{name:'Keyframe 0.00s',exact:true}).click();
 await expect(page.getByRole('slider',{name:/Audio volume/})).toBeVisible();
 await page.getByRole('slider',{name:/Audio volume/}).fill('0.5');
 await expect.poll(async()=>(await read()).tracks.flatMap(t=>t.clips).find(c=>c.id===overlay.id)!.volume).toBe(.5);
 await page.screenshot({path:'test-results/video-overlay-desktop.png'});
 await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Open Inspector',exact:true}).click();await page.getByRole('slider',{name:/Audio volume/}).scrollIntoViewIfNeeded();
 await expect(page.getByRole('slider',{name:/Audio volume/})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:'test-results/video-overlay-mobile.png'});await page.getByRole('button',{name:'Close Inspector',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);await expect(video).toBeVisible();await page.screenshot({path:'test-results/video-overlay-mobile-preview.png'});await page.setViewportSize({width:1440,height:960});
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Export MP4',exact:true}).click();await(await download).saveAs('test-results/video-overlay-browser.mp4');
 const rendered=await mcp(request,'viral_hit_editor_render',{projectId:id});const response=await request.get(rendered.structuredContent.result.asset.publicUrl);await writeFile('test-results/video-overlay-server.mp4',await response.body());
 const level=(file:string)=>{const pcm=execFileSync(ffmpeg,['-v','error','-ss','1.2','-i',file,'-t','1','-vn','-af','pan=mono|c0=c0','-ar','24000','-f','f32le','-']);let sum=0;for(let i=0;i<pcm.length;i+=4)sum+=pcm.readFloatLE(i)**2;return Math.sqrt(sum/(pcm.length/4));};
 const sourceLevel=level(file),audioLevels:Record<string,number>={source:sourceLevel};
 const measurements=[];
 for(const name of ['browser','server']){
  for(const time of [.5,1.5,2.5,3.5]){
   const frame=execFileSync(ffmpeg,['-v','error','-ss',String(time),'-i',`test-results/video-overlay-${name}.mp4`,'-frames:v','1','-vf','scale=320:180','-f','rawvideo','-pix_fmt','rgb24','-']);
   const x=Math.round((.25+(time-1)*.25)*320),center=(90*320+Math.max(0,Math.min(319,x)))*3,pixel=[...frame.subarray(center,center+3)];
   if(time<1||time>=3)expect(frame.reduce((max,value)=>Math.max(max,value),0)).toBeLessThan(10);
   else{expect(pixel[time<2?2:1],name+':'+time+':'+pixel).toBeGreaterThan(220);expect(pixel[0]).toBeLessThan(15);}
   measurements.push({name,time,pixel});
  }
  const rms=level(`test-results/video-overlay-${name}.mp4`);audioLevels[name]=rms;expect(Math.abs(rms/sourceLevel-.5)).toBeLessThan(.06);
 }
 await writeFile('test-results/video-overlay-evidence.json',JSON.stringify({projectId:id,measurements,audioLevels,timeline:await read()},null,2));
});
