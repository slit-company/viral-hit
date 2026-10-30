import { promptOf, optionsOf, aspectOf, secondsOf, referencesOf } from './options.mjs';
const MODEL_DEFAULT = 'model-default';
// Runtime side of schema-profile.mjs: turns Studio input plus uploaded reference URLs into the upstream request body.

/** Validates input and returns the references that still need uploading, in Studio order. */
export function admit(model, binding, input) {
  const prompt = promptOf(input, { required: binding.prompt?.required ?? false, max: binding.prompt?.max ?? 10_000 });
  if (!binding.prompt && prompt) throw Error(model.name + ' does not take a text prompt; leave it empty');
  if (input.maskUrl && !binding.mask) throw Error(model.name + ' does not accept a mask');
  return { prompt, options: optionsOf(model, input), aspect: aspectOf(model, input), seconds: secondsOf(model, input), refs: referencesOf(model, input) };
}

function shaped(slot, urls) {
  if (slot.shape === 'keyframes') return urls.length === 1 ? urls[0] : urls.map((uri, index) => ({ uri, position: index ? 'last' : 'first' }));
  const item = uri => slot.shape === 'uri-object' ? { uri, ...(slot.type ? { type: slot.type } : {}) } : slot.shape === 'url-object' ? { url: uri } : slot.shape === 'image-url-object' ? { image_url: uri } : uri;
  return slot.many ? urls.map(item) : item(urls[0]);
}

/** uploaded: { image: string[], video: string[], audio: string[], mask?: string } with provider-reachable URLs. */
export function requestBody(model, binding, admitted, uploaded, seed) {
  const body = { ...binding.fixed };
  if (binding.prompt && admitted.prompt) body[binding.prompt.field] = admitted.prompt;
  for (const control of binding.controls) {
    const chosen = admitted.options[control.key];
    if (control.synthetic || chosen === undefined || chosen === '' || chosen === MODEL_DEFAULT) continue;
    body[control.field] = control.format ? format(chosen, control.format) : chosen;
  }
  if (binding.aspect && admitted.aspect) {
    if (binding.aspect.table) {
      const tiers = binding.aspect.table[admitted.aspect], tier = admitted.options.resolution;
      body[binding.aspect.field] = tiers[tier] ?? tiers['720p'] ?? Object.values(tiers)[0];
    } else if (admitted.aspect !== 'auto' || binding.aspect.map.auto) body[binding.aspect.field] = binding.aspect.map[admitted.aspect];
  }
  if (binding.duration && admitted.seconds !== undefined) body[binding.duration.field] = format(admitted.seconds, binding.duration.format);
  if (binding.seed && Number.isInteger(seed)) body[binding.seed] = seed;
  for (const kind of ['image', 'video', 'audio']) {
    const queue = [...(uploaded[kind] ?? [])];
    for (const slot of binding.media.filter(item => item.kind === kind)) {
      if (!queue.length) break;
      const taken = queue.splice(0, slot.many || slot.shape === 'keyframes' ? slot.max : 1);
      body[slot.field] = shaped(slot, taken);
    }
    if (queue.length) throw Error('Too many ' + kind + ' references for ' + model.name);
  }
  if (binding.mask && uploaded.mask) body[binding.mask] = uploaded.mask;
  return body;
}

const format = (seconds, kind) => kind === 'string' ? String(seconds) : kind === 'string-s' ? seconds + 's' : Number(seconds);

/** Finds result media URLs or inline base64 blocks of one kind in a provider response. */
export function collectMedia(value, kind, found = [], depth = 0, hint = '') {
  if (depth > 5 || found.length >= 8 || value == null) return found;
  const matches = name => !name || new RegExp(kind === 'image' ? 'image|output|result|file|data' : kind === 'video' ? 'video|output|result|file' : 'audio|music|speech|sound|output|result|file', 'i').test(name);
  if (typeof value === 'string') {
    if (/^https:\/\//.test(value) && matches(hint)) found.push({ url: value });
    return found;
  }
  if (Array.isArray(value)) { for (const item of value) collectMedia(item, kind, found, depth + 1, hint); return found; }
  if (typeof value !== 'object') return found;
  if (typeof value.url === 'string' && /^https:\/\//.test(value.url) && (matches(hint) || (value.content_type ?? '').startsWith(kind + '/'))) { found.push({ url: value.url, type: value.content_type }); return found; }
  for (const [key, item] of Object.entries(value)) if (!/thumbnail|preview|poster|cover|input|request|prompt|logs/i.test(key)) collectMedia(item, kind, found, depth + 1, key);
  return found;
}
