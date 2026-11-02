import { refs, select } from './controls.mjs';

const ratios = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '4:5', '5:4', '21:9'];
const image = (id, name, upstreamModelId, aspectRatios, max, controls) => ({
  id: 'comfy-' + id, name, upstreamModelId, kind: 'image',
  studioTasks: max ? ['image-generate', 'image-edit'] : ['image-generate'],
  aspectRatios, defaultAspectRatio: '1:1', referenceInputs: refs(0, max), controls,
});
const edit = (id, name, upstream, controls) => ({
  ...image(id, name, upstream, ['auto'], 1, controls), defaultAspectRatio: 'auto',
  studioTasks: ['image-edit'], referenceInputs: refs(1, 1),
});
export const imageProfiles = [
  image('nano-banana-pro', 'Nano Banana Pro', 'vertexai/gemini-3-pro-image', ratios, 14, [select('resolution', 'Resolution', ['1K', '2K', '4K'])]),
  image('nano-banana-2.1', 'Nano Banana 2.1', 'vertexai/gemini-nano-banana-2.1', ratios, 14, [select('resolution', 'Resolution', ['1K', '2K', '4K'])]),
  ...['sunburst', 'flare'].map(variant => image('gpt-image-2.5-' + variant, 'GPT Image 2.5 ' + (variant === 'flare' ? 'Flare' : 'Sunburst'),
    'openai/gpt-image-2.5-' + variant, ['1:1', '3:2', '2:3', 'auto'], 16,
    [select('quality', 'Quality', ['high', 'medium', 'low', 'xhigh', 'max', 'auto']), select('background', 'Background', ['auto', 'opaque', 'transparent'])])),
  image('seedream-5.0-pro', 'Seedream 5.0 Pro', 'byteplus/seedream-5-0-pro-260628', ratios, 10, [select('resolution', 'Resolution', ['1K', '2K'])]),
  image('grok-imagine-image-2.0', 'Grok Imagine Image 2.0', 'xai/grok-imagine-image-2.0', ratios.filter(ratio => !['4:5', '5:4', '21:9'].includes(ratio)), 0,
    [select('resolution', 'Resolution', ['1k', '2k']), select('quality', 'Quality', ['auto', 'low', 'medium', 'high'])]),
  image('ideogram-v4', 'Ideogram V4', 'ideogram/ideogram-v4', ratios, 0, []),
  edit('bria-relight', 'Bria Relight', 'bria/image-edit-relight', [
    select('light_direction', 'Light direction', ['front', 'side', 'bottom', 'top-down']),
    select('light_type', 'Lighting', ['midday', 'blue hour light', 'low-angle sunlight', 'sunrise light', 'spotlight on subject, keep background settings',
      'overcast light', 'soft overcast daylight lighting', 'cloud-filtered lighting', 'fog-diffused lighting', 'moonlight lighting',
      'starlight lighting nighttime', 'soft bokeh lighting', 'harsh studio lighting keep background setting']),
  ]),
  edit('bria-remove-background', 'Bria Remove Background', 'bria/image-edit-remove-background', []),
];
