import { sequenceSchema } from '../src/core/editor/sequence';
import { closeSync, fstatSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { z } from 'zod';
import { compileRecipe, compileRecipeForCheck, recipeSchema } from '../src/core/harness/recipes';
import { comfyRecipeDefinitionSchema, importComfyRecipe, inspectComfyGraph } from '../src/core/harness/import-comfy-recipe';
import { preflightComfyPlan } from '../src/core/harness/comfy-preflight';
const [command, file, values, projectId] = process.argv.slice(2);
function readJson(path: string): unknown {
  const fd = openSync(path, 'r');
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > 128_000) throw new Error('Expected a JSON file no larger than 128 KB');
    const bytes = readFileSync(fd);
    if (bytes.byteLength > 128_000) throw new Error('JSON file exceeds 128 KB');
    return JSON.parse(bytes.toString('utf8'));
  } finally { closeSync(fd); }
}
try {
  if (command === 'schema' && file) writeFileSync(file, JSON.stringify(z.toJSONSchema(recipeSchema), null, 2) + '\n');
  else if (command === 'sequence-schema' && file) writeFileSync(file, JSON.stringify(z.toJSONSchema(sequenceSchema), null, 2) + '\n');
  else if (command === 'comfy-schema' && file) writeFileSync(file, JSON.stringify(z.toJSONSchema(comfyRecipeDefinitionSchema), null, 2) + '\n');
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
  } else throw new Error('Usage: recipe schema|sequence-schema|comfy-schema <output.json> | inspect-comfy <api-graph.json> | import-comfy <api-graph.json> <definition.json> <new-recipe.json> | compile|preflight <recipe.json> <values.json> <project-id>');
} catch (error) { console.error(error instanceof Error ? error.message : 'Recipe failed'); process.exitCode = 1; }
