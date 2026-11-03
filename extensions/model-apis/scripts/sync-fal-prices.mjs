#!/usr/bin/env node
// Refreshes src/providers/fal/pricing.json from fal's pricing API. Needs FAL_KEY; read-only, nothing is generated.
// Rates in seconds, images, megapixels, minutes or characters are kept as listed. Rates in fal's own units
// or tokens become fal's reported average per request (basis "average").
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const key = process.env.FAL_KEY?.trim();
if (!key) throw Error('Set FAL_KEY to read fal prices');
const headers = { Authorization: 'Key ' + key, 'content-type': 'application/json' };
const catalog = JSON.parse(await readFile(join(root, 'src/providers/fal/catalog.json'), 'utf8'));
const models = (catalog.models ?? catalog).map(entry => entry.model);
const checked = new Date().toISOString().slice(0, 10);
const UNITS = { image: ['output', 1], images: ['output', 1], video: ['output', 1], videos: ['output', 1], megapixel: ['megapixel', 1], megapixels: ['megapixel', 1], second: ['second', 1], seconds: ['second', 1], minute: ['second', 1 / 60], minutes: ['second', 1 / 60], character: ['character', 1], characters: ['character', 1], '1000 characters': ['character', 1 / 1000], generation: ['request', 1], generations: ['request', 1], request: ['request', 1], requests: ['request', 1] };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

export function listedPrice(price) {
  const unit = UNITS[String(price.unit).trim().toLowerCase()];
  return unit && price.currency === 'USD' ? { per: unit[0], amount: Math.round(price.unit_price * unit[1] * 1e6) / 1e6 } : null;
}

async function averagePerRequest(endpoint) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const response = await fetch('https://api.fal.ai/v1/models/pricing/estimate', { method: 'POST', headers, body: JSON.stringify({ estimate_type: 'historical_api_price', endpoints: { [endpoint]: { call_quantity: 1 } } }) });
    if (response.status === 429) { await wait(15_000); continue; }
    if (!response.ok) return null;
    const body = await response.json();
    return body.currency === 'USD' && Number.isFinite(body.total_cost) ? body.total_cost : null;
  }
  return null;
}

const ids = models.map(model => model.upstreamModelId);
const response = await fetch('https://api.fal.ai/v1/models/pricing?' + ids.map(id => 'endpoint_id=' + encodeURIComponent(id)).join('&'), { headers });
if (!response.ok) throw Error('fal pricing returned ' + response.status);
const prices = new Map((await response.json()).prices.map(price => [price.endpoint_id, price]));
const pricing = {};
for (const model of models) {
  const price = prices.get(model.upstreamModelId);
  if (!price) continue;
  const source = 'https://fal.ai/models/' + model.upstreamModelId;
  const listed = listedPrice(price);
  if (listed) { pricing[model.id] = { currency: 'USD', per: listed.per, amount: listed.amount, basis: 'list', source, checked }; continue; }
  const average = await averagePerRequest(model.upstreamModelId);
  if (average !== null) pricing[model.id] = { currency: 'USD', per: 'request', amount: average, basis: 'average', source, checked };
  await wait(6_500);
}
await writeFile(join(root, 'src/providers/fal/pricing.json'), JSON.stringify(pricing, null, 1) + '\n');
console.log('fal prices: ' + Object.keys(pricing).length + ' of ' + models.length + ' models');
