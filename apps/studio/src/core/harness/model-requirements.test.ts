import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import type { Plan, Json } from './durable';
const directory = mkdtempSync(join(tmpdir(), 'vh-model-requirements-'));
process.env.VIRAL_HIT_DATA_DIR = join(directory, 'data');
process.env.VIRAL_HIT_PROVIDERS_DIR = join(directory, 'providers');
process.env.VIRAL_HIT_RECIPES_DIR = join(directory, 'recipes');
mkdirSync(process.env.VIRAL_HIT_PROVIDERS_DIR); mkdirSync(process.env.VIRAL_HIT_RECIPES_DIR);
for (const name of ['procedural-images', 'procedural-audio', 'visual-conform', 'media-inspector']) cpSync(resolve('../../examples/providers', name), join(process.env.VIRAL_HIT_PROVIDERS_DIR, name), { recursive: true });
const folder = join(process.env.VIRAL_HIT_PROVIDERS_DIR, 'check-fixture'); mkdirSync(folder);
writeFileSync(join(folder, 'provider.mjs'), "throw Error('Requirement inspection cannot execute provider code');");
writeFileSync(join(folder, 'provider.json'), JSON.stringify({ schemaVersion: 1, kind: 'viral-hit-provider', id: 'check-fixture', label: 'Configured elsewhere', scope: 'specialized', environment: ['VH_REQUIREMENT_SECRET'], models: [{ id: 'check-image', name: 'Custom image', kind: 'image', aspectRatios: ['1:1'] }] }));
after(() => { delete process.env.VH_REQUIREMENT_SECRET; rmSync(directory, { recursive: true, force: true }); });
const { inspectModelRequirements } = await import('./model-requirements.server');
const { preflightRecipePlan } = await import('./recipe-preflight.server');
const { inspectRecipe } = await import('./recipe-library');
const { compileRecipeForCheck } = await import('./recipes');
const { listModelRecipeModels, buildModelRecipe } = await import('./model-recipe.server');
const plan = (modelId = 'procedural-gradient', extra: Record<string, Json> = {}): Plan => ({ projectId: 'no-project-read', nodes: [{ id: 'create', operation: 'generation.model', version: '1', input: { schemaVersion: 1, mode: 'image', modelId, prompt: 'Direction', parameters: {}, ...extra } }] });
const report = (modelId: string, extra: Record<string, Json> = {}) => inspectModelRequirements(plan(modelId, extra));

test('missing and unconfigured independent models are distinct; inspection reads neither credentials nor provider execution identity', async () => {
  const missing = report('external-model'); assert.equal(missing.status, 'issues'); assert.equal(missing.models[0].status, 'missing');
  assert.match(missing.issues[0].message, /exact model ID/);
  const unconfigured = report('check-image'); assert.equal(unconfigured.models[0].status, 'unconfigured');
  process.env.VH_REQUIREMENT_SECRET = 'sensitive-fixture-value';
  const available = report('check-image'); assert.equal(available.status, 'checked'); assert.equal(available.models[0].status, 'available');
  assert.equal(JSON.stringify(available).includes('sensitive-fixture-value'), false);
  assert.equal(JSON.stringify(available).includes('VH_REQUIREMENT_SECRET'), false);
  assert.equal(existsSync(process.env.VIRAL_HIT_DATA_DIR!), false);
  delete process.env.VH_REQUIREMENT_SECRET;
  const mixed = plan('external-model'); mixed.nodes.push({ ...plan('check-image').nodes[0], id: 'second' });
  const combined = await preflightRecipePlan(mixed); assert.equal(combined.status, 'issues'); assert.deepEqual(combined.models?.map(item => item.status), ['missing', 'unconfigured']);
});

test('fixed kind, counts, prompt, options and aspect selections use the current installed contract', () => {
  for (const [id, input, pointer] of [
    ['procedural-gradient', { mode: 'video' }, '/mode'],
    ['procedural-gradient', { prompt: ' ' }, '/prompt'],
    ['procedural-gradient', { parameters: { aspect_ratio: '2:3' } }, '/parameters/aspect_ratio'],
    ['procedural-gradient', { parameters: { provider_options: { unexpected: true } } }, '/parameters/provider_options'],
    ['visual-frame', {}, '/references'],
    ['visual-frame', { references: [{assetId:'one',kind:'video',role:'audio_track'}] }, '/references'],
    ['procedural-sound', { mode:'audio',parameters:{provider_options:{frequency:20}} }, '/parameters/provider_options'],
    ['procedural-sound', { mode:'audio',parameters:{aspect_ratio:'1:1'} }, '/parameters/aspect_ratio'],
    ['technical-video-review', {mode:'analysis',references:[{assetId:'one',kind:'video'}],parameters:{max_output_tokens:3}}, '/parameters/max_output_tokens'],
  ] as [string, Record<string, Json>, string][]) {
    const inspected = report(id, input); assert.equal(inspected.status, 'issues', id + JSON.stringify(input));
    assert.ok(inspected.issues.some(issue => issue.severity === 'issue' && issue.input === pointer), JSON.stringify(inspected));
  }
  assert.equal(report('procedural-sound', {mode:'audio'}).status,'checked');
  assert.equal(report('visual-cut',{mode:'video',references:[{assetId:'one',kind:'video'}],parameters:{provider_options:{seconds:1}}}).status,'checked');
});

test('unfilled inputs and upstream values are deferred without hiding fixed incompatible settings', () => {
  const chosen = listModelRecipeModels().find(model => model.id === 'visual-cut')!;
  const recipe = buildModelRecipe({ schemaVersion:1,id:'check-portable',version:'1.0.0',title:'Portable',description:'Independent recipe',author:'Contributor',license:'MIT',category:'creation',modelId:chosen.id,referenceCounts:{image:1,video:1,audio:1}},chosen.digest);
  const checked = compileRecipeForCheck(recipe, {}, 'placeholder-only');
  const inspected = inspectModelRequirements(checked.plan, checked.deferredInputs);
  assert.equal(inspected.status,'checked'); assert.ok(inspected.issues.some(issue => issue.input === '/prompt' && issue.severity === 'deferred'));
  assert.ok(inspected.issues.some(issue => issue.input === '/references' && issue.severity === 'deferred'));
  const dynamic = plan('procedural-sound',{mode:'audio',parameters:{provider_options:{frequency:0,unknown:1}}});
  dynamic.nodes[0].bindings=[{node:'earlier',pointer:'/frequency',target:'/parameters/provider_options/frequency'}];
  const result = inspectModelRequirements(dynamic);
  assert.ok(result.issues.some(issue => issue.severity === 'issue' && issue.message.includes('Unknown model option')));
  assert.ok(result.issues.some(issue => issue.severity === 'deferred' && issue.input?.endsWith('/frequency')));
  const illegal = plan(); illegal.nodes[0].bindings=[{node:'earlier',pointer:'/text',target:'/modelId'}];
  assert.equal(inspectModelRequirements(illegal).status,'issues');
  assert.ok(inspectModelRequirements(plan(),{create:['/modelId']}).issues.some(issue => issue.severity === 'deferred'));
});

test('recipe inspection and preflight report the same requirements without changing the portable recipe digest', async () => {
  const recipe=JSON.parse(readFileSync('../../examples/provider-recipes/image.json','utf8'));
  recipe.parameters.find((p: {id:string}) => p.id === 'model').default='external-model';
  const before=JSON.stringify(recipe), inspected=await inspectRecipe(recipe);
  assert.equal(inspected.modelRequirements?.models[0].status,'missing');
  const prepared=compileRecipeForCheck(recipe,{},'project');
  const checked=await preflightRecipePlan(prepared.plan,{deferredInputs:prepared.deferredInputs});
  assert.deepEqual(checked.models,inspected.modelRequirements?.models); assert.deepEqual(checked.issues,inspected.modelRequirements?.issues);
  assert.equal(JSON.stringify(recipe),before);
  assert.equal((await inspectRecipe(JSON.parse(before))).digest,inspected.digest);
  assert.equal(existsSync(process.env.VIRAL_HIT_DATA_DIR!),false);
  assert.equal((await preflightRecipePlan({projectId:'p',nodes:[{id:'x',operation:'asset.materialize',version:'1',input:{url:'https://example.invalid/file.png',kind:'image'}}]})).status,'not-applicable');
});

test('CLI preflight returns actionable issues with exit code 2 and never allocates a workspace database', () => {
  const recipe=JSON.parse(readFileSync('../../examples/provider-recipes/image.json','utf8')); recipe.parameters.find((p: {id:string}) => p.id === 'model').default='external-model';
  const file=join(directory,'recipe.json'), values=join(directory,'values.json');writeFileSync(file,JSON.stringify(recipe));writeFileSync(values,'{}');
  const cli=spawnSync(process.execPath,['--import','tsx','scripts/recipe.ts','preflight',file,values,'no-project-read'],{env:process.env,encoding:'utf8',timeout:30000});
  assert.equal(cli.status,2,cli.stderr);const result=JSON.parse(cli.stdout);assert.equal(result.models[0].modelId,'external-model');assert.equal(result.models[0].status,'missing');
  assert.equal(existsSync(process.env.VIRAL_HIT_DATA_DIR!),false);
});
