import { createHash } from 'node:crypto';
import { readFile, open, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getViralHitDataRoot } from '../src/config/data-root';
import { writeTar } from '../src/core/projects/bundles/tar.server';
import { validateCreativeManifest } from '../src/core/creative-packs/manifest.server';
import { validatePack } from '../src/core/harness/recipe-pack-library';
import { validateCatalog } from '../src/core/community/service.server';
const root = getViralHitDataRoot();
if (!root.includes('viral-hit-e2e-'))
  throw new Error('Catalog fixtures require an isolated workspace');
const manifest = JSON.parse(
  await readFile('skills/official/consistent-characters/skill.json', 'utf8'),
);
const skill = {
  schemaVersion: 1,
  kind: 'viral-hit-skill',
  manifest: {
    ...manifest,
    id: 'catalog-general-skill',
    title: 'Shared planning',
    summary: 'Plan any editable story.',
    inputs: [],
    stages: [],
  },
  instructions:
    'Plan a story for any project. Review the plan before generating.',
};
await writeFile(join(root, 'catalog-skill.json'), JSON.stringify(skill));
const recipes = JSON.parse(
  await readFile('../../packs/editing-basics.json', 'utf8'),
);
const recipeId = recipes.id;
recipes.id = 'catalog-editing';
recipes.title = 'Community editing basics';
recipes.recipes = recipes.recipes.map((recipe: { id: string }) => ({
  ...recipe,
  id: recipe.id.replace(recipeId + '-', 'catalog-editing-'),
}));
validatePack(recipes);
await writeFile(join(root, 'catalog-recipes.json'), JSON.stringify(recipes));
const creative = validateCreativeManifest({
  schemaVersion: 1,
  kind: 'viral-hit-creative-pack',
  id: 'catalog-product-kit',
  version: '1.0.0',
  title: 'Product story kit',
  description: 'Plan a particular product format.',
  scope: 'specialized',
  author: 'Independent studio',
  license: 'MIT',
  useCases: ['product-stories'],
  recipes: [],
  characters: [],
  skills: [
    {
      ...skill,
      manifest: {
        ...skill.manifest,
        id: 'catalog-product-skill',
        scope: 'specialized',
        title: 'Product story planning',
      },
      instructions:
        'Plan a product story and review the approved claims before generation.',
    },
  ],
});
const tar = await open(join(root, 'catalog-creative.tar'), 'wx');
try {
  await writeTar(
    tar,
    Buffer.from(JSON.stringify(creative)),
    [],
    AbortSignal.timeout(5000),
  );
} finally {
  await tar.close();
}
const sha = async (name: string) =>
  createHash('sha256')
    .update(await readFile(join(root, name)))
    .digest('hex');
const catalog = validateCatalog({
  schemaVersion: 1,
  kind: 'viral-hit-catalog',
  id: 'independent-studio',
  title: 'Independent studio',
  author: 'Community creator',
  description:
    'General tools and specialized creative workflows, shared from one repository.',
  entries: [
    {
      id: 'planning',
      title: 'Shared planning',
      summary: 'Plan a story for any project.',
      scope: 'general',
      kind: 'skill',
      version: '1.0.0',
      tags: ['story', 'planning'],
      url: 'https://public-packs.viralhit.test/skill.json',
      sha256: await sha('catalog-skill.json'),
    },
    {
      id: 'product-kit',
      title: 'Product story kit',
      summary: 'A shot-planning skill for a product launch.',
      scope: 'specialized',
      kind: 'creative-pack',
      version: '1.0.0',
      tags: ['product', 'launch'],
      url: 'https://public-packs.viralhit.test/creative.tar',
      sha256: await sha('catalog-creative.tar'),
    },
    {
      id: 'editing',
      title: 'Community editing basics',
      summary: 'Reusable steps for editable media.',
      scope: 'general',
      kind: 'recipe-pack',
      version: '1.0.0',
      tags: ['editing'],
      url: 'https://public-packs.viralhit.test/recipes.json',
      sha256: await sha('catalog-recipes.json'),
    },
    {
      id: 'changed-file',
      title: 'Shared planning',
      summary: 'A file whose bytes changed after catalog publication.',
      scope: 'general',
      kind: 'skill',
      version: '1.0.0',
      tags: ['changed'],
      url: 'https://public-packs.viralhit.test/mismatch.json',
      sha256: '0'.repeat(64),
    },
  ],
});
await writeFile(join(root, 'catalog.json'), JSON.stringify(catalog));
