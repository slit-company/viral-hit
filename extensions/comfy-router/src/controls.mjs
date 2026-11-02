export const select = (key, label, values, initial = values[0]) => ({ key, label, type: 'select', default: initial, choices: values.map(value => ({ value, label: value })) });
export const boolean = (key, label = 'Generate audio', initial = true) => ({ key, label, type: 'boolean', default: initial });
export const seconds = values => values.map(value => value + 's');
export const refs = (min, max, audio = 0) => ({ image: { min, max }, video: { min: 0, max: 0 }, audio: { min: 0, max: audio } });
export const dataUri = media => 'data:' + media.mimeType + ';base64,' + media.base64;
export const referenceMode = () => select('reference_mode', 'Use images as', ['frames', 'references']);
