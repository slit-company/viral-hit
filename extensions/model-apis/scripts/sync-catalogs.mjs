#!/usr/bin/env node
// Refreshes catalog.json for the schema-driven providers from each vendor's official, public schema source.
// Run when a vendor adds or changes models; the committed catalogs keep builds offline and reproducible.
import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { profileFromSchema } from '../src/kit/schema-profile.mjs';
import { selection as fal } from '../src/providers/fal/selection.mjs';
import { selection as runway } from '../src/providers/runway/selection.mjs';
import { selection as higgsfield } from '../src/providers/higgsfield/selection.mjs';
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const only = process.argv.slice(2);

async function get(url, as = 'json') {
  const response = await fetch(url, { headers: { 'User-Agent': 'viral-hit-catalog-sync' }, signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw Error(url + ' returned HTTP ' + response.status);
  return as === 'json' ? response.json() : response.text();
}

function deref(node, document, depth = 0) {
  if (depth > 12 || !node || typeof node !== 'object') return node;
  if (Array.isArray(node)) return node.map(item => deref(item, document, depth + 1));
  if (typeof node.$ref === 'string') return deref(node.$ref.slice(2).split('/').reduce((value, key) => value?.[key], document), document, depth + 1);
  return Object.fromEntries(Object.entries(node).map(([key, value]) => [key, deref(value, document, depth + 1)]));
}

/** A model is usable only when every required upstream field is bound to Studio input. */
function covered({ model, binding }, schema) {
  const bound = new Set([binding.prompt?.field, binding.aspect?.field, binding.duration?.field, binding.seed, binding.mask, ...binding.media.map(item => item.field), ...binding.controls.map(item => item.field), ...Object.keys(binding.fixed)]);
  const missing = (schema.required ?? []).filter(name => !bound.has(name) && name !== 'model');
  if (missing.length) console.warn('skip ' + model.id + ': unbound required ' + missing.join(', '));
  return !missing.length;
}

async function build(id, entries, schemaFor) {
  const models = [];
  for (const entry of entries) {
    try {
      const schema = await schemaFor(entry);
      const profile = profileFromSchema(id, entry, schema);
      if (covered(profile, schema)) models.push(profile);
    } catch (error) { console.warn('skip ' + entry.endpoint + ': ' + error.message); }
  }
  if (models.length > 50) throw Error(id + ' has more than 50 models');
  await writeFile(join(root, 'src/providers', id, 'catalog.json'), JSON.stringify({ source: id, synced: new Date().toISOString().slice(0, 10), models }, null, 1) + '\n');
  console.log(id + ': ' + models.length + '/' + entries.length + ' models');
}

const sources = {
  async fal() {
    await build('fal', fal, async entry => {
      const document = await get('https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=' + encodeURIComponent(entry.endpoint));
      const schema = deref(document.paths['/' + entry.endpoint]?.post?.requestBody?.content?.['application/json']?.schema, document);
      if (!schema?.properties) throw Error('no input schema');
      return schema;
    });
  },
  async runway() {
    const document = await get('https://docs.dev.runwayml.com/openapi.json');
    await build('runway', runway, async entry => {
      const schema = deref(document.paths[entry.path]?.post?.requestBody?.content?.['application/json']?.schema, document);
      const variants = schema?.oneOf ?? schema?.anyOf;
      const chosen = variants ? variants.find(item => item.title === entry.model || item.properties?.model?.enum?.includes(entry.model) || item.properties?.model?.const === entry.model) : schema;
      if (!chosen?.properties) throw Error('no schema for ' + entry.model);
      return chosen;
    });
  },
  async higgsfield() {
    const text = await get('https://docs.higgsfield.ai/llms-full.txt', 'text');
    const schemas = new Map();
    for (const section of text.split(/\n(?=# )/)) {
      const id = /\*\*Endpoint ID:\*\* `([^`]+)`/.exec(section)?.[1];
      const block = /> \*\*Complete JSON schema\*\*[\s\S]*?> ```json[^\n]*\n([\s\S]*?)> ```/.exec(section)?.[1];
      if (id && block) schemas.set(id, JSON.parse(block.split('\n').map(line => line.replace(/^> ?/, '')).join('\n')));
    }
    await build('higgsfield', higgsfield, async entry => {
      const schema = schemas.get(entry.endpoint);
      if (!schema?.properties) throw Error('not in the Higgsfield documentation');
      return schema;
    });
  },
};
for (const [id, run] of Object.entries(sources)) if (!only.length || only.includes(id)) await run();
