import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import {
  VIRAL_HIT_SKILL_CATALOG_URI,
  createViralHitSkillRegistry,
  loadViralHitSkillRegistry,
  type ViralHitSkillDefinition,
} from './skill-registry';

const definition = (id = 'ugc-director'): ViralHitSkillDefinition => ({
  manifest: {
    schemaVersion: 1,
    id,
    version: '1.0.0',
    title: 'UGC Director',
    summary: 'Plan a reviewable UGC production workflow.',
    visibility: 'showcase',
    compatibility: {
      minimumViralHitVersion: '0.2.3',
      requiredMcpTools: ['viral_hit_canvas_apply'],
    },
    requiredCapabilities: ['image-to-video'],
    inputs: [],
    stages: [],
    showcase: {
      category: 'ugc',
      tags: ['video'],
      featured: true,
    },
  },
  instructions: '# UGC Director\n\nPrepare the Canvas before generation.',
});

test('Skill registry returns descriptors without leaking full instructions', () => {
  const registry = createViralHitSkillRegistry({
    definitions: [definition()],
    viralHitVersion: '0.2.3',
    availableMcpTools: ['viral_hit_canvas_apply'],
  });

  const [descriptor] = registry.list();
  assert.equal(descriptor.manifest.id, 'ugc-director');
  assert.equal(descriptor.resourceUri, `${VIRAL_HIT_SKILL_CATALOG_URI}/ugc-director`);
  assert.equal(descriptor.compatible, true);
  assert.equal('instructions' in descriptor, false);
  assert.match(registry.get('ugc-director')?.instructions ?? '', /Prepare the Canvas/);
});

test('Skill registry reports version and MCP compatibility failures', () => {
  const registry = createViralHitSkillRegistry({
    definitions: [definition()],
    viralHitVersion: '0.2.2',
    availableMcpTools: [],
  });

  const [descriptor] = registry.list();
  assert.equal(descriptor.compatible, false);
  assert.deepEqual(descriptor.incompatibilities, [
    'Requires ViralHit 0.2.3 or newer.',
    'Missing MCP tools: viral_hit_canvas_apply.',
  ]);
});

test('Skill registry rejects duplicate ids', () => {
  assert.throws(
    () =>
      createViralHitSkillRegistry({
        definitions: [definition(), definition()],
        viralHitVersion: '0.2.3',
        availableMcpTools: ['viral_hit_canvas_apply'],
      }),
    /Duplicate ViralHit Skill id/
  );
});

test('filesystem loader validates directory names and reads fixed Skill files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'viral-hit-skills-'));
  const skillDirectory = resolve(root, 'ugc-director');
  try {
    await mkdir(skillDirectory);
    await writeFile(
      resolve(skillDirectory, 'skill.json'),
      `${JSON.stringify(definition().manifest)}\n`
    );
    await writeFile(
      resolve(skillDirectory, 'SKILL.md'),
      definition().instructions
    );

    const registry = await loadViralHitSkillRegistry({
      directory: root,
      viralHitVersion: '0.2.3',
      availableMcpTools: ['viral_hit_canvas_apply'],
    });
    assert.equal(registry.list().length, 1);
    assert.equal(registry.get('ugc-director')?.manifest.title, 'UGC Director');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('filesystem loader treats a missing official directory as an empty catalog', async () => {
  const registry = await loadViralHitSkillRegistry({
    directory: resolve(tmpdir(), 'viral-hit-skills-directory-does-not-exist'),
    viralHitVersion: '0.2.3',
    availableMcpTools: [],
  });
  assert.deepEqual(registry.catalog().skills, []);
});

test('a local skills folder adds general or specialized skills and reports the ones it cannot load', async () => {
  const root = await mkdtemp(join(tmpdir(), 'viral-hit-skill-sources-'));
  const write = async (folder: string, directory: string, manifest: unknown, instructions = '# Skill\n\nSteps.') => {
    await mkdir(resolve(root, folder, directory), { recursive: true });
    await writeFile(resolve(root, folder, directory, 'skill.json'), JSON.stringify(manifest));
    await writeFile(resolve(root, folder, directory, 'SKILL.md'), instructions);
  };
  try {
    await write('official', 'ugc-director', definition().manifest);
    await write('local', 'shop-reels', { ...definition('shop-reels').manifest, scope: 'specialized', author: 'A shop', license: 'MIT' });
    await write('local', 'ugc-director', { ...definition().manifest, title: 'Copy' });
    await write('local', 'broken', { ...definition('broken').manifest, scope: 'everything' });
    await write('local', 'misnamed', definition('other-name').manifest);
    const registry = await loadViralHitSkillRegistry({ directory: resolve(root, 'official'), localDirectory: resolve(root, 'local'), viralHitVersion: '0.2.3', availableMcpTools: ['viral_hit_canvas_apply'] });
    const catalog = registry.catalog();
    assert.deepEqual(catalog.skills.map((skill) => [skill.manifest.id, skill.source, skill.manifest.scope]), [['shop-reels', 'local', 'specialized'], ['ugc-director', 'official', 'general']]);
    assert.equal(registry.get('ugc-director')?.manifest.title, 'UGC Director');
    assert.equal(registry.get('shop-reels')?.manifest.license, 'MIT');
    assert.deepEqual(catalog.problems.map((problem) => problem.location).sort(), ['broken', 'misnamed', 'ugc-director']);
    assert.match(catalog.problems.find((problem) => problem.location === 'ugc-director')!.message, /already provided by the official skill/);
    const missing = await loadViralHitSkillRegistry({ directory: resolve(root, 'official'), localDirectory: resolve(root, 'nowhere'), viralHitVersion: '0.2.3', availableMcpTools: [] });
    assert.deepEqual(missing.catalog().problems, [{ source: 'local', location: 'nowhere', message: 'Skills folder not found.' }]);
    await write('official', 'broken-official', { ...definition('broken-official').manifest, scope: 'everything' });
    await assert.rejects(loadViralHitSkillRegistry({ directory: resolve(root, 'official'), viralHitVersion: '0.2.3', availableMcpTools: [] }));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
