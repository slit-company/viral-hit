import { createHash } from 'node:crypto';
// Build-time converter: an official JSON input schema becomes a public Viral Hit model entry plus a private request binding.
const RATIOS = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '4:5', '5:4', '21:9', '9:21', '2:1', '1:2'];
const IMAGE_SIZES = { square_hd: '1:1', landscape_16_9: '16:9', portrait_16_9: '9:16', landscape_4_3: '4:3', portrait_4_3: '3:4' };
const SKIP = /^(webhook.*|sync_mode|enable_safety_checker|safety_tolerance|end_user_id|user|draft|draft_?task_?id|content_?moderation|output|storage_options|num_images|n|batch_size|num_outputs|output_?count|codec|bitrate_mode|output_?format|prores_?profile|enable_logging|deferred|response_format|acceleration|loras|callback_url|request_id|enable_prompt_expansion|expand_prompt|seed|timestamps|limit_generations)$/i;
const NEUTRAL = ['auto', 'default', 'standard', 'medium', 'high', 'opaque', 'balanced', 'none', '720p', '1080p'];
export const MODEL_DEFAULT = 'model-default';
const PRIORITY = ['resolution', 'quality', 'mode', 'style', 'generate_audio', 'audio', 'negative_prompt', 'voice', 'camera', 'motion'];
const PROMPTS = ['prompt', 'promptText', 'text'];
const LIMIT = { image: 14, video: 3, audio: 3 };

const value = schema => {
  const variants = schema?.anyOf ?? schema?.oneOf;
  if (!variants) return schema ?? {};
  const real = variants.filter(item => item.type !== 'null');
  return { ...real[0], ...(real.length > 1 ? { variants: real } : {}), description: schema.description ?? real[0]?.description, default: schema.default ?? real[0]?.default };
};
const snake = name => name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/[^a-zA-Z0-9]+/g, '_').toLowerCase().replace(/^_+|_+$/g, '').slice(0, 40);
const label = name => { const words = snake(name).replace(/_url(s)?$/, '').split('_').filter(Boolean).join(' '); return (words[0]?.toUpperCase() ?? '') + words.slice(1); };
const describe = schema => typeof schema.description === 'string' ? { description: schema.description.replace(/\s+/g, ' ').slice(0, 140) } : {};
const ratioNumber = text => { const match = /^(\d+(?:\.\d+)?)[:x](\d+(?:\.\d+)?)$/.exec(text); return match ? Number(match[1]) / Number(match[2]) : null; };
const nearestRatio = text => { const number = ratioNumber(text); return number && RATIOS.find(ratio => Math.abs(ratioNumber(ratio) - number) / number < 0.025); };

export function modelId(prefix, endpoint) {
  const slug = (prefix + '-' + endpoint.replace(/^fal-ai\//, '')).toLowerCase().replace(/[^a-z0-9.]+/g, '-').replace(/^-+|-+$/g, '');
  return slug.length <= 64 ? slug : slug.slice(0, 57).replace(/-+$/, '') + '-' + createHash('sha256').update(slug).digest('hex').slice(0, 6);
}

function mediaKind(name) {
  if (/mask/i.test(name)) return 'mask';
  if (/audio|voice|music|sound|speech/i.test(name)) return 'audio';
  if (/video|motion|clip/i.test(name)) return 'video';
  if (/image|frame|reference|ref|photo|subject|style|face|product|character|element|logo|start|end/i.test(name)) return 'image';
  return null;
}

function mediaSlot(name, raw, required, override) {
  const schema = value(raw), kind = override ?? mediaKind(name);
  if (!kind) return null;
  if (name === 'promptImage') return { field: name, kind: 'image', shape: 'keyframes', max: 2, required };
  const array = schema.type === 'array' ? schema : schema.variants?.find(item => item.type === 'array');
  if (array) {
    const items = value(array.items);
    const shape = items.type === 'string' ? 'url' : items.properties?.uri ? 'uri-object' : items.properties?.url ? 'url-object' : items.properties?.image_url ? 'image-url-object' : null;
    if (!shape) return null;
    const type = items.properties?.type?.enum?.[0] ?? items.properties?.type?.const;
    return { field: name, kind, many: true, shape, ...(type ? { type } : {}), max: Math.min(array.maxItems ?? LIMIT[kind] ?? 4, LIMIT[kind] ?? 4), required: required || (array.minItems ?? 0) > 0 };
  }
  const looksLikeUrl = schema.format === 'uri' || /(_url|Uri|Url)$/.test(name) || /^(image|video|audio|promptVideo|videoUri)$/.test(name);
  if (schema.type === 'string' && looksLikeUrl) return { field: name, kind, shape: 'url', max: 1, required };
  if (schema.type === 'object' && (schema.properties?.url || schema.properties?.uri)) return { field: name, kind, shape: schema.properties.uri ? 'uri-object' : 'url-object', max: 1, required };
  return null;
}

const slotOrder = slot => (slot.required ? 0 : 4) + (/end|last|tail/i.test(slot.field) ? 2 : 0) + (slot.many ? 3 : 0);

function durationBinding(name, raw, kind) {
  const schema = value(raw);
  const numeric = schema.enum ? schema.enum.map(item => Number.parseInt(String(item), 10)).filter(Number.isFinite) : null;
  let seconds = numeric ?? (Number.isFinite(schema.minimum) && Number.isFinite(schema.maximum) ? Array.from({ length: Math.floor(schema.maximum) - Math.ceil(schema.minimum) + 1 }, (_, i) => Math.ceil(schema.minimum) + i) : null);
  if (!seconds?.length) return null;
  if (seconds.length > 12) { const preferred = [seconds[0], 5, 6, 8, 10, 12, 15, 20, 25, 30, 45, 60]; seconds = [...new Set(preferred.filter(item => seconds.includes(item)))].slice(0, 12); }
  const sample = schema.enum?.find(item => item !== 'auto');
  const format = typeof sample === 'string' ? (sample.endsWith('s') ? 'string-s' : 'string') : schema.type === 'number' ? 'number' : 'integer';
  const fallback = Number.parseInt(String(schema.default), 10);
  const chosen = seconds.includes(fallback) ? fallback : seconds.find(item => item >= 5) ?? seconds[0];
  if (kind !== 'video') return { control: { key: snake(name), label: 'Length (seconds)', type: 'number', min: seconds[0], max: seconds.at(-1), default: chosen, integer: format !== 'number' }, binding: { key: snake(name), field: name, format } };
  return { durations: seconds.map(item => item + 's'), defaultDuration: chosen + 's', binding: { field: name, format } };
}

function aspectBinding(name, raw) {
  const schema = value(raw);
  if (name === 'image_size' && schema.enum) {
    const map = Object.fromEntries(schema.enum.filter(item => IMAGE_SIZES[item]).map(item => [IMAGE_SIZES[item], item]));
    return Object.keys(map).length ? { ratios: Object.keys(map), map, fallback: map['1:1'] ? '1:1' : Object.keys(map)[0] } : null;
  }
  if (!schema.enum) return null;
  const values = schema.enum.filter(item => typeof item === 'string');
  if (name === 'ratio' && values.every(item => /^\d+:\d+$/.test(item) && Number(item.split(':')[0]) > 30)) {
    const table = {};
    for (const item of values) {
      const [width, height] = item.split(':').map(Number), aspect = nearestRatio(item);
      if (!aspect) continue;
      const tier = Math.min(width, height) >= 2000 ? '4k' : Math.min(width, height) >= 1000 ? '1080p' : Math.min(width, height) >= 700 ? '720p' : '480p';
      (table[aspect] ??= {})[tier] ??= item;
    }
    const tiers = [...new Set(Object.values(table).flatMap(Object.keys))].sort((a, b) => Number.parseInt(a) - Number.parseInt(b));
    const fallback = table['16:9'] ? '16:9' : Object.keys(table)[0];
    return Object.keys(table).length ? { ratios: Object.keys(table), table, tiers, fallback, defaultValue: schema.default } : null;
  }
  const map = {};
  for (const item of values) if (item === 'auto' || RATIOS.includes(item)) map[item] = item;
  if (!Object.keys(map).length) return null;
  const fallback = map[schema.default] ? schema.default : map['16:9'] ? '16:9' : Object.keys(map)[0];
  return { ratios: Object.keys(map), map, fallback };
}

function control(name, raw, isRequired) {
  const schema = value(raw), key = snake(name);
  if (!/^[a-z][a-z0-9_]{0,39}$/.test(key)) return null;
  const base = { key, label: label(name), ...describe(schema) };
  // fal documents some closed choices as examples rather than enum; accept only short single-word values.
  const choices = schema.enum ?? (schema.type === 'string' && Array.isArray(schema.examples) && schema.examples.includes(schema.default) && schema.examples.every(item => typeof item === 'string' && /^[\w.-]{1,40}$/.test(item)) ? schema.examples : null);
  if (choices?.length && choices.length <= 31 && choices.every(item => typeof item === 'string' && item.length <= 120)) {
    // Without a vendor default, an optional choice is omitted unless the user picks one.
    const open = !choices.includes(schema.default) && !isRequired;
    const fallback = choices.includes(schema.default) ? schema.default : open ? MODEL_DEFAULT : NEUTRAL.find(item => choices.includes(item)) ?? choices[0];
    return { ...base, type: 'select', default: fallback, choices: [...(open ? [{ value: MODEL_DEFAULT, label: 'Model default' }] : []), ...choices.map(item => ({ value: item, label: item }))] };
  }
  if (schema.type === 'boolean') return { ...base, type: 'boolean', default: schema.default === true };
  if ((schema.type === 'number' || schema.type === 'integer') && Number.isFinite(schema.minimum) && Number.isFinite(schema.maximum)) return { ...base, type: 'number', min: schema.minimum, max: schema.maximum, default: Number.isFinite(schema.default) ? schema.default : schema.minimum, ...(schema.type === 'integer' ? { integer: true } : {}) };
  if (schema.type === 'string' && /negative_prompt|voice|style_prompt|lyrics/i.test(name)) return { ...base, type: 'string', default: typeof schema.default === 'string' ? schema.default.slice(0, 2000) : '', maxLength: /lyrics/.test(name) ? 4000 : 2000, multiline: !/voice/.test(name) };
  return null;
}

/** entry: { endpoint, name, kind, tasks, id?, fixed?, path? }; schema: the endpoint's JSON input schema. */
export function profileFromSchema(prefix, entry, schema) {
  const properties = schema.properties ?? {}, required = new Set(schema.required ?? []);
  const binding = { endpoint: entry.endpoint, ...(entry.path ? { path: entry.path } : {}), fixed: { ...(entry.fixed ?? {}) }, controls: [], media: [] };
  const model = { id: entry.id ?? modelId(prefix, entry.endpoint), name: entry.name, kind: entry.kind, upstreamModelId: entry.endpoint.slice(0, 200), studioTasks: entry.tasks };
  const controls = [];
  for (const [name, raw] of Object.entries(properties)) {
    if (name === 'model') continue;
    if (PROMPTS.includes(name) && !binding.prompt) { binding.prompt = { field: name, required: required.has(name), max: value(raw).maxLength ?? 10_000 }; continue; }
    if (/^(seed)$/i.test(name) && entry.kind !== 'audio') { binding.seed = name; continue; }
    if (/^(aspect_?ratio|ratio|image_size)$/i.test(name) && entry.kind !== 'audio' && !binding.aspect) {
      const aspect = aspectBinding(name, raw);
      if (aspect) {
        model.aspectRatios = aspect.ratios; model.defaultAspectRatio = aspect.fallback;
        binding.aspect = { field: name, ...(aspect.map ? { map: aspect.map } : { table: aspect.table }) };
        if (aspect.tiers?.length > 1) controls.push({ control: { key: 'resolution', label: 'Resolution', type: 'select', default: aspect.tiers.includes('720p') ? '720p' : aspect.tiers[0], choices: aspect.tiers.map(item => ({ value: item, label: item })) }, binding: { key: 'resolution', synthetic: true } });
        continue;
      }
    }
    if (/^(duration|duration_seconds|seconds|video_length)$/i.test(name)) {
      const duration = durationBinding(name, raw, entry.kind);
      if (duration?.durations) { model.durations = duration.durations; model.defaultDuration = duration.defaultDuration; binding.duration = duration.binding; continue; }
      if (duration?.control) { controls.push(duration); continue; }
    }
    const slot = mediaSlot(name, raw, required.has(name), entry.media?.[name]);
    if (slot) { if (slot.kind !== 'mask') binding.media.push(slot); else { binding.mask = slot.field; model.maskInput = { required: required.has(name) }; } continue; }
    if (SKIP.test(name)) continue;
    const item = control(name, raw, required.has(name));
    if (item) controls.push({ control: item, binding: { key: item.key, field: name } });
  }
  controls.sort((a, b) => (PRIORITY.findIndex(word => a.control.key.includes(word)) + 1 || 99) - (PRIORITY.findIndex(word => b.control.key.includes(word)) + 1 || 99));
  const kept = controls.slice(0, 16);
  if (kept.length) model.controls = kept.map(item => item.control);
  binding.controls = kept.map(item => item.binding);
  binding.media.sort((a, b) => slotOrder(a) - slotOrder(b));
  const ranges = { image: { min: 0, max: 0 }, video: { min: 0, max: 0 }, audio: { min: 0, max: 0 } };
  for (const slot of binding.media) { ranges[slot.kind].min += slot.required ? 1 : 0; ranges[slot.kind].max += slot.max; }
  for (const kind of Object.keys(ranges)) ranges[kind].max = Math.min(ranges[kind].max, LIMIT[kind]);
  let total = ranges.image.max + ranges.video.max + ranges.audio.max;
  while (total > 20 && ranges.image.max > ranges.image.min) { ranges.image.max--; total--; }
  if (total > 0) model.referenceInputs = ranges;
  if (binding.prompt?.required === false && !binding.media.length) binding.prompt.required = true;
  if (entry.kind !== 'audio' && !model.aspectRatios) { model.aspectRatios = ['auto']; model.defaultAspectRatio = 'auto'; }
  return { model, binding };
}
