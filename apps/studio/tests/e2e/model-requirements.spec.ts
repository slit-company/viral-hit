import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
const headers = { 'x-viral-hit-workspace-request': '1' };
async function mcp(request: APIRequestContext, name: string, args: unknown) {
  const response=await request.post('http://127.0.0.1:3043/mcp',{headers:{authorization:'Bearer e2e-local-only',accept:'application/json, text/event-stream'},data:{jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}}});
  const text=await response.text(),result=JSON.parse(text.startsWith('{')?text:text.split('\n').find(line=>line.startsWith('data: '))!.slice(6)).result;
  expect(result.isError,JSON.stringify(result)).not.toBe(true);return result.structuredContent.result;
}
async function library(page: Page, request: APIRequestContext, manifest: unknown) {
  const project=(await(await request.post('/api/app/projects',{headers,data:{name:'Independent recipe requirements'}})).json());
  await page.goto('/studio/'+project.id);await page.getByRole('button',{name:'Generation runs'}).click();await page.getByRole('button',{name:'Recipe library',exact:true}).click();
  await page.getByLabel('Recipe JSON',{exact:true}).fill(JSON.stringify(manifest));await page.getByRole('button',{name:'Inspect JSON',exact:true}).click();
  return project.id as string;
}
test('a shared recipe exposes missing models before install, then rechecks changed values through the same HTTP and MCP contract',async({page,request})=>{
  const recipe=JSON.parse(await readFile('../../examples/provider-recipes/image.json','utf8'));recipe.id='missing-model-'+Date.now();recipe.parameters[0].default='independent-uninstalled-image';
  const projectId=await library(page,request,recipe);
  const review=page.getByRole('region',{name:'Recipe inspection'});
  await expect(review.getByRole('status',{name:'Model requirements'}).getByText('Model requirements: needs attention')).toBeVisible();
  await expect(review.getByText('Can be saved locally; resolve model requirements before running.')).toBeVisible();
  const inspected=await mcp(request,'viral_hit_recipe_library',{request:{action:'inspect',manifest:recipe}});expect(inspected.modelRequirements.models[0].status).toBe('missing');
  await page.getByRole('button',{name:'Install recipe',exact:true}).click();await expect(page.getByLabel('Creative recipe',{exact:true})).toHaveValue(recipe.id);
  await page.getByRole('button',{name:'Check requirements',exact:true}).click();
  const check=page.getByRole('status',{name:'Server check result'});await expect(check.getByText(/independent-uninstalled-image · missing/)).toBeVisible();
  await expect(page.getByRole('button',{name:'Queue generation',exact:true})).toBeDisabled();
  const queueBounds=await page.getByRole('button',{name:'Queue generation',exact:true}).boundingBox(),bodyBounds=await page.getByTestId('runs-body').boundingBox();
  expect(queueBounds!.y+queueBounds!.height).toBeLessThanOrEqual(bodyBounds!.y+bodyBounds!.height);
  const body={recipeId:recipe.id,values:{},expectedRecipeDigest:inspected.digest};
  const http=await(await request.post(`/api/app/projects/${projectId}/preflight`,{headers,data:body})).json();
  const agent=await mcp(request,'viral_hit_recipe_check',{projectId,...body});expect(agent.models).toEqual(http.models);expect(agent.issues).toEqual(http.issues);
  expect((await(await request.get(`/api/app/projects/${projectId}/generations`)).json()).items).toHaveLength(0);
  expect((await(await request.get(`/api/app/projects/${projectId}/runs`)).json()).runs).toHaveLength(0);
  await page.getByLabel('Installed image model ID',{exact:true}).fill('procedural-gradient');await expect(check).toHaveCount(0);
  await page.getByRole('button',{name:'Check requirements',exact:true}).click();await expect(check.getByText(/procedural-gradient · available/)).toBeVisible();
  await expect(page.getByRole('button',{name:'Queue generation',exact:true})).toBeEnabled();
  const queued=page.waitForResponse(r=>r.url().endsWith(`/projects/${projectId}/runs`)&&r.request().method()==='POST');await page.getByRole('button',{name:'Queue generation',exact:true}).click();expect((await queued).status()).toBe(202);
});

test('phone checks distinguish changed model choices from deferred project sources and keep actions accessible',async({page,request})=>{
  await page.setViewportSize({width:390,height:844});
  const catalog=await mcp(request,'viral_hit_recipe_library',{request:{action:'model_catalog'}}),model=catalog.models.find((m:{id:string})=>m.id==='visual-frame');
  const built=await mcp(request,'viral_hit_recipe_library',{request:{action:'build_model',expectedModelDigest:model.digest,definition:{schemaVersion:1,id:'frame-requirements-'+Date.now(),version:'1.0.0',title:'Independent source frame',description:'Frame with adjustable references',author:'Independent author',license:'MIT',category:'creation',tags:['specialized'],modelId:model.id,referenceCounts:{image:0,video:1,audio:0},outputIndex:0}}});
  const recipe=built.recipe,aspect=recipe.parameters.find((p:{id:string})=>p.id==='aspect-ratio');aspect.options.push('2:3');aspect.default='2:3';
  const projectId=await library(page,request,recipe),review=page.getByRole('region',{name:'Recipe inspection'});
  await expect(review.getByText('Model requirements: needs attention',{exact:true})).toBeVisible();
  await expect(review.getByText(/Choose a aspect_ratio declared by this model/)).toBeVisible();
  await page.getByRole('button',{name:'Install recipe',exact:true}).click();await expect(page.getByLabel('Creative recipe',{exact:true})).toHaveValue(recipe.id);
  await page.getByRole('button',{name:'Check requirements',exact:true}).click();const check=page.getByRole('status',{name:'Server check result'});
  await expect(check.getByText('Server check: needs attention',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Queue generation',exact:true})).toBeDisabled();
  await page.getByLabel('Aspect ratio',{exact:true}).selectOption('1:1');await page.getByRole('button',{name:'Check requirements',exact:true}).click();
  await expect(check.getByText('Server check: no reported issues',{exact:true})).toBeVisible();
  await expect(check.getByText(/Project source ownership/)).toBeVisible();
  await expect(page.getByRole('button',{name:'Queue generation',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'Check requirements',exact:true}).scrollIntoViewIfNeeded();
  const action=await page.getByRole('button',{name:'Check requirements',exact:true}).boundingBox(),dialog=await page.getByRole('dialog').boundingBox();
  expect(action!.y+action!.height).toBeLessThanOrEqual(dialog!.y+dialog!.height);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect((await(await request.get(`/api/app/projects/${projectId}/runs`)).json()).runs).toHaveLength(0);
});

test('a late check response cannot replace a changed recipe input',async({page,request})=>{
  const recipe=JSON.parse(await readFile('../../examples/provider-recipes/image.json','utf8'));recipe.id='fenced-check-'+Date.now();
  const projectId=await library(page,request,recipe);await page.getByRole('button',{name:'Install recipe',exact:true}).click();await expect(page.getByLabel('Creative recipe',{exact:true})).toHaveValue(recipe.id);
  let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});let entered!:()=>void;const requested=new Promise<void>(resolve=>{entered=resolve;});
  await page.route(`**/projects/${projectId}/preflight`,async route=>{const response=await route.fetch();entered();await gate;await route.fulfill({response});});
  await page.getByRole('button',{name:'Check requirements',exact:true}).click();await requested;
  await page.getByLabel('Installed image model ID',{exact:true}).fill('new-uninstalled-model');
  const completed=page.waitForResponse(r=>r.url().endsWith('/preflight'));release();await completed;
  await expect(page.getByRole('status',{name:'Server check result'})).toHaveCount(0);await expect(page.getByRole('button',{name:'Check requirements',exact:true})).toBeEnabled();
});
