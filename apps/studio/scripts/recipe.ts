import { readFileSync, writeFileSync } from 'node:fs';
import { z } from 'zod';
import { compileRecipe, recipeSchema } from '../src/core/harness/recipes';
const [command, file, values, projectId] = process.argv.slice(2);
try {
  if (command === 'schema' && file) writeFileSync(file, JSON.stringify(z.toJSONSchema(recipeSchema), null, 2) + '\n');
  else if (command === 'compile' && file && values && projectId) {
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    const supplied = JSON.parse(readFileSync(values, 'utf8'));
    console.log(JSON.stringify(compileRecipe(raw, supplied, projectId), null, 2));
  } else throw new Error('Usage: recipe schema <output.json> | compile <recipe.json> <values.json> <project-id>');
} catch (error) { console.error(error instanceof Error ? error.message : 'Recipe failed'); process.exitCode = 1; }
