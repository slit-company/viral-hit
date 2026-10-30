// Validates Studio input against a model's public manifest entry before anything is sent.
export function promptOf(input, { required = true, max = 10_000 } = {}) {
  const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : '';
  if ((required && !prompt) || prompt.length > max) throw Error('Enter a prompt of ' + (required ? 1 : 0) + '–' + max + ' characters');
  return prompt;
}

export function optionsOf(model, input) {
  const controls = model.controls ?? [];
  const values = Object.fromEntries(controls.map(control => [control.key, control.default]));
  for (const [key, value] of Object.entries(input.options ?? {})) {
    const control = controls.find(item => item.key === key);
    if (!control) throw Error('Unknown model option: ' + key);
    const valid = control.type === 'boolean' ? typeof value === 'boolean'
      : control.type === 'number' ? typeof value === 'number' && Number.isFinite(value) && value >= control.min && value <= control.max && (!control.integer || Number.isInteger(value))
      : control.type === 'select' ? control.choices.some(choice => choice.value === value)
      : typeof value === 'string' && value.length <= control.maxLength;
    if (!valid) throw Error('Invalid value for ' + control.label);
    values[key] = value;
  }
  return values;
}

export function aspectOf(model, input) {
  const ratios = model.aspectRatios ?? [];
  const value = input.aspectRatio ?? model.defaultAspectRatio;
  if (value && ratios.length && !ratios.includes(value)) throw Error('Unsupported aspect ratio for ' + model.name);
  return value;
}

export function secondsOf(model, input) {
  const value = input.duration ?? model.defaultDuration;
  if (!value) return undefined;
  if (model.durations && !model.durations.includes(value)) throw Error('Unsupported length for ' + model.name);
  return Number.parseInt(value, 10);
}

/** Checks per-kind reference counts against the declared referenceInputs. */
export function referencesOf(model, input) {
  const refs = { image: input.imageUrls ?? [], video: input.videoUrls ?? [], audio: input.audioUrls ?? [] };
  for (const [kind, list] of Object.entries(refs)) {
    const range = model.referenceInputs?.[kind] ?? { min: 0, max: kind === 'image' ? model.maxReferenceImages ?? 0 : 0 };
    if (!Array.isArray(list) || list.length < range.min || list.length > range.max) throw Error(model.name + ' needs ' + range.min + '–' + range.max + ' ' + kind + ' reference(s)');
  }
  return refs;
}

// Control helpers for hand-written manifests.
export const select = (key, label, values, fallback = values[0], labels = {}) => ({ key, label, type: 'select', default: fallback, choices: values.map(value => ({ value, label: labels[value] ?? value })) });
export const toggle = (key, label, fallback = false) => ({ key, label, type: 'boolean', default: fallback });
export const number = (key, label, min, max, fallback, integer = false) => ({ key, label, type: 'number', min, max, default: fallback, ...(integer ? { integer } : {}) });
export const text = (key, label, fallback = '', maxLength = 200) => ({ key, label, type: 'string', default: fallback, maxLength });
export const refs = (image = [0, 0], video = [0, 0], audio = [0, 0]) => ({ image: { min: image[0], max: image[1] }, video: { min: video[0], max: video[1] }, audio: { min: audio[0], max: audio[1] } });

/** Removes runtime-only binding fields so the manifest matches the public provider schema. */
export const publicModel = ({ binding, ...model }) => model;
