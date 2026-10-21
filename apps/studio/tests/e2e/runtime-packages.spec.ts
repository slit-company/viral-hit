import {test,expect,type APIRequestContext} from '@playwright/test';
import {readFile,mkdir} from 'node:fs/promises';
const headers={'x-viral-hit-workspace-request':'1'};
async function call(request:APIRequestContext,body:unknown){const response=await request.post('http://127.0.0.1:3043/mcp',{headers:{authorization:'Bearer e2e-local-only',accept:'application/json, text/event-stream'},data:{jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'viral_hit_runtime_package',arguments:{request:body}}}});const text=await response.text(),rpc=JSON.parse(text.startsWith('{')?text:text.split('\n').find(line=>line.startsWith('data: '))!.slice(6));expect(rpc.result?.isError,JSON.stringify(rpc)).not.toBe(true);return rpc.result.structuredContent.result;}
test('runtime skill flow stages reviewed code, exposes pending activation and removes it without changing loaded capabilities',async({page,request})=>{
  const source=await readFile('../../examples/adapters/tone/tone.mjs','utf8'),manifest=JSON.parse(await readFile('../../examples/adapters/tone/tone.json','utf8'));manifest.operation='ext.independent-runtime-proof';
  const pkg={schemaVersion:1,kind:'viral-hit-runtime-package',id:'independent-runtime-proof',version:'1.0.0',title:'Independent runtime proof',description:'A portable workflow step for any project',author:'Independent author',license:'MIT',scope:'general',entries:[{kind:'adapter',manifest,source}]};
  const review=await call(request,{action:'inspect',package:pkg});expect(review.blocking).toEqual([]);expect(review.package.entries[0].source).toBe(source);
  const applied=await call(request,{action:'apply',package:review.package,expectedDigest:review.digest,expectedStateDigest:review.stateDigest,trustCode:true});expect(applied.restartRequired).toBe(true);
  const status=await(await request.get('/api/app/runtime-packages')).json();expect(status.installed.some((item:{id:string})=>item.id===pkg.id)).toBe(true);expect(status.loaded.some((item:{id:string})=>item.id===pkg.id)).toBe(false);
  await page.goto('/extensions');await expect(page.getByRole('heading',{name:'Know what’s connected.'})).toBeVisible();await expect(page.getByText('Managed runtime changes are pending. Restart studio, MCP and workers together to activate them.')).toBeVisible();
  const evidence='../../research/evidence/runtime-packages';await mkdir(evidence,{recursive:true});await page.screenshot({path:evidence+'/pending-desktop.png'});await page.setViewportSize({width:390,height:844});await page.getByText('Managed runtime changes are pending. Restart studio, MCP and workers together to activate them.').scrollIntoViewIfNeeded();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:evidence+'/pending-mobile.png'});
  const stale=await request.post('/api/app/runtime-packages',{headers,data:{action:'apply',package:review.package,expectedDigest:review.digest,expectedStateDigest:review.stateDigest,trustCode:true}});expect(stale.status()).toBe(409);
  const remove=await call(request,{action:'review-remove',id:pkg.id});await call(request,{action:'remove',id:pkg.id,expectedStateDigest:remove.stateDigest});
  expect((await call(request,{action:'list'})).restartRequired).toBe(false);
  expect((await call(request,{action:'export',id:pkg.id,digest:review.digest})).entries[0].source).toBe(source);
  await page.getByRole('button',{name:'Refresh status',exact:true}).click();await expect(page.getByText('Managed runtime changes are pending. Restart studio, MCP and workers together to activate them.')).toHaveCount(0);
});
