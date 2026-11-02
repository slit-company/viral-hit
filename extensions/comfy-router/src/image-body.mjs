import { dataUri } from './controls.mjs';

const ideogramSizes = { '1:1': '2048x2048', '16:9': '2560x1440', '9:16': '1440x2560', '4:3': '2304x1728', '3:4': '1728x2304',
  '3:2': '2496x1664', '2:3': '1664x2496', '4:5': '1792x2240', '5:4': '2240x1792', '21:9': '3168x1296' };

/** Seedream's explicit size keeps the selected ratio within its 1–4 megapixel range. */
const seedreamSize = (aspect, resolution) => {
  const [w, h] = aspect.split(':').map(Number), area = resolution === '2K' ? 4_000_000 : 1_100_000;
  return Math.round(Math.sqrt(area * w / h) / 8) * 8 + 'x' + Math.round(Math.sqrt(area * h / w) / 8) * 8;
};

export function buildImageBody(profile, { prompt, options, aspect }, images) {
  const id = profile.upstreamModelId;
  if (id.startsWith('vertexai/')) return {
    contents: [{ role: 'user', parts: [...images.map(image => ({ inlineData: { data: image.base64, mimeType: image.mimeType } })), { text: prompt }] }],
    generationConfig: { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio: aspect, imageSize: options.resolution } },
    uploadImagesToStorage: true,
  };
  if (id.startsWith('openai/')) return {
    prompt, n: 1, size: ({ '1:1': '1024x1024', '3:2': '1536x1024', '2:3': '1024x1536', auto: 'auto' })[aspect],
    quality: options.quality, background: options.background, output_format: 'png', ...(images.length ? { image: images.map(dataUri) } : {}),
  };
  if (id.startsWith('byteplus/')) return {
    prompt, size: seedreamSize(aspect, options.resolution), output_format: 'png', response_format: 'url', watermark: false,
    ...(images.length ? { image: images.map(dataUri) } : {}),
  };
  if (id.startsWith('xai/')) return { prompt, n: 1, aspect_ratio: aspect, resolution: options.resolution, quality: options.quality, response_format: 'url' };
  if (id.startsWith('ideogram/')) return { text_prompt: prompt, resolution: ideogramSizes[aspect] };
  if (id.startsWith('bria/')) return { image: images[0].base64, ...(id.endsWith('relight') ? { light_direction: options.light_direction, light_type: options.light_type } : {}) };
  throw Error('Unsupported Comfy Router image model');
}
