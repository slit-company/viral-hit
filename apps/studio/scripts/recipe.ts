import { sequenceSchema } from '../src/core/editor/sequence';
import { closeSync, fstatSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { z } from 'zod';
import { compileRecipe, compileRecipeForCheck, recipeSchema } from '../src/core/harness/recipes';
import { comfyRecipeDefinitionSchema, importComfyRecipe, inspectComfyGraph } from '../src/core/harness/import-comfy-recipe';
import { preflightComfyPlan } from '../src/core/harness/comfy-preflight';
import { changeRecipePacks } from '../src/core/harness/recipe-pack-library';
import { MAX_PACK_BYTES, MAX_PACK_RECIPES, packManifestSchema } from '../src/core/harness/recipe-packs';
const [command, file, values, projectId] = process.argv.slice(2);
function readJson(path: string, limit = 128_000): unknown {
  const fd = openSync(path, 'r');
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > limit) throw new Error('Expected a JSON file no larger than ' + Math.round(limit / 1000) + ' KB');
    const bytes = readFileSync(fd);
    if (bytes.byteLength > limit) throw new Error('JSON file is too large');
    return JSON.parse(bytes.toString('utf8'));
  } finally { closeSync(fd); }
}
try {
  if (command === 'schema' && file) writeFileSync(file, JSON.stringify(z.toJSONSchema(recipeSchema, { io: 'input' }), null, 2) + '\n');
  else if (command === 'pack-schema' && file) writeFileSync(file, JSON.stringify(z.toJSONSchema(packManifestSchema.extend({ recipes: z.array(recipeSchema).min(1).max(MAX_PACK_RECIPES) }), { io: 'input' }), null, 2) + '\n');
  else if (command === 'sequence-schema' && file) writeFileSync(file, JSON.stringify(z.toJSONSchema(sequenceSchema, { io: 'input' }), null, 2) + '\n');
  else if (command === 'comfy-schema' && file) writeFileSync(file, JSON.stringify(z.toJSONSchema(comfyRecipeDefinitionSchema, { io: 'input' }), null, 2) + '\n');
  else if (command === 'packs') console.log(JSON.stringify(await changeRecipePacks({ action: 'list' }), null, 2));
  else if (command === 'fetch-pack' && file && values) {
    const result = await changeRecipePacks({ action: 'fetch', url: file, expectedSha256: projectId });
    if (!('manifest' in result) || !('inspection' in result)) throw new Error('Pack fetch did not return a review');
    writeFileSync(values, JSON.stringify(result.manifest, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify({ file: values, inspection: result.inspection }, null, 2));
  }
  else if (command === 'inspect-pack' && file) console.log(JSON.stringify(await changeRecipePacks({ action: 'inspect', pack: readJson(file, MAX_PACK_BYTES) }), null, 2));
  else if (command === 'install-pack' && file && values) console.log(JSON.stringify(await changeRecipePacks({ action: 'install', pack: readJson(file, MAX_PACK_BYTES), expectedDigest: values }), null, 2));
  else if (command === 'build-pack' && file && values) {
    // Never overwrite an existing pack file.
    const result = await changeRecipePacks({ action: 'build', pack: readJson(file) as never }) as { manifest: { id: string } };
    writeFileSync(values, JSON.stringify(result.manifest, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify({ id: result.manifest.id, file: values }));
  }
  else if (command === 'inspect-comfy' && file) console.log(JSON.stringify(inspectComfyGraph(readJson(file)), null, 2));
  else if (command === 'import-comfy' && file && values && projectId) {
    const recipe = importComfyRecipe(readJson(file), readJson(values));
    // Never overwrite the source graph, definition, or an existing installed recipe.
    writeFileSync(projectId, JSON.stringify(recipe, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify({ id: recipe.id, version: recipe.version, file: projectId }));
  }
  else if ((command === 'compile' || command === 'preflight') && file && values && projectId) {
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    const supplied = JSON.parse(readFileSync(values, 'utf8'));
    if (command === 'preflight') {
      const { plan, deferredInputs } = compileRecipeForCheck(raw, supplied, projectId);
      const report = await preflightComfyPlan(plan, { deferredInputs }); console.log(JSON.stringify(report, null, 2));
      process.exitCode = report.status === 'issues' ? 2 : report.status === 'unavailable' ? 3 : 0;
    } else console.log(JSON.stringify(compileRecipe(raw, supplied, projectId), null, 2));
  } else throw new Error('Usage: recipe schema|pack-schema|sequence-schema|comfy-schema <output.json> | packs | fetch-pack <url> <new-file> [sha256] | build-pack <definition.json> <new-pack.json> | inspect-pack <pack.json> | install-pack <pack.json> <digest> | inspect-comfy <api-graph.json> | import-comfy <api-graph.json> <definition.json> <new-recipe.json> | compile|preflight <recipe.json> <values.json> <project-id>');
} catch (error) { console.error(error instanceof Error ? error.message : 'Recipe failed'); process.exitCode = 1; }
