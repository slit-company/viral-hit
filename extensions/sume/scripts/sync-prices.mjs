#!/usr/bin/env node
// Refreshes src/pricing.json from the prices Sume lists with its video and image models. Needs SUME_API_KEY; read-only.
import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { profiles } from '../src/profiles.mjs';

/** Sume's per-image or per-second USD price for one of our profiles, by resolution and quality when they are options. */
export function sumePricing(model, profile, checked) {
  const pricing = model?.pricing ?? {};
  const per = pricing.basis === 'per_image' ? 'output' : String(pricing.basis ?? '').startsWith('per_second') ? 'second' : null;
  if (!per) return null;
  const base = { currency: 'USD', per, basis: 'list', source: 'https://www.sume.com/docs/models', checked };
  const options = (pricing.usd_options ?? []).filter(item => Number(item.usd) > 0);
  const controls = new Set((profile.controls ?? []).map(control => control.key));
  const keys = ['resolution', 'quality'].filter(name => controls.has(name) && options.some(item => item[name] !== undefined));
  if (keys.length) {
    const amounts = {};
    // The first listed price for a key wins, which is the smallest size when size is not an option.
    for (const item of options) if (keys.every(name => item[name] !== undefined)) amounts[keys.map(name => String(item[name])).join('|')] ??= Number(item.usd);
    const values = Object.values(amounts);
    if (values.length) return { ...base, by: { option: keys.length === 1 ? keys[0] : keys, amounts }, amount: Math.max(...values) };
  }
  const flat = Number(pricing.usd_per_image ?? pricing.usd_per_second ?? options[0]?.usd);
  return Number.isFinite(flat) && flat > 0 ? { ...base, amount: flat } : null;
}

if (import.meta.url === 'file://' + process.argv[1]) {
  const key = process.env.SUME_API_KEY?.trim();
  if (!key) throw Error('Set SUME_API_KEY to read Sume prices');
  const listed = new Map();
  for (const route of ['video-router', 'image-router']) {
    const response = await fetch('https://api.sume.com/v1/' + route + '/models', { headers: { Authorization: 'Bearer ' + key } });
    if (!response.ok) throw Error('Sume ' + route + ' models returned ' + response.status);
    const data = (await response.json()).data;
    for (const model of data.models ?? data) listed.set(model.id, model);
  }
  const checked = new Date().toISOString().slice(0, 10), pricing = {};
  for (const profile of profiles) {
    const price = profile.upstreamModelId && sumePricing(listed.get(profile.upstreamModelId), profile, checked);
    if (price) pricing[profile.id] = price;
  }
  await writeFile(join(dirname(dirname(fileURLToPath(import.meta.url))), 'src/pricing.json'), JSON.stringify(pricing, null, 1) + '\n');
  console.log('Sume prices: ' + Object.keys(pricing).length + ' of ' + profiles.length + ' profiles');
}
