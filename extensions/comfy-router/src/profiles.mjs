const select = (key, label, values, initial = values[0]) => ({ key, label, type: 'select', default: initial, choices: values.map(value => ({ value, label: value })) });
const boolean = (key, label, initial = true) => ({ key, label, type: 'boolean', default: initial });
const seconds = values => values.map(value => value + 's');
const refs = (min, max) => ({ image: { min, max }, video: { min: 0, max: 0 }, audio: { min: 0, max: 0 } });
/** Comfy Router model IDs and fields follow docs.comfy.org/router-schemas (checked 2026-10-30). */
export const profiles = [
  { id: 'comfy-flux-3-image', name: 'FLUX 3 Image', kind: 'image', upstreamModelId: 'bfl/flux-3-image', studioTasks: ['image-generate', 'image-edit'], aspectRatios: ['auto', '1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '4:5', '5:4', '21:9', '9:21', '2:1', '1:2'], defaultAspectRatio: '1:1', referenceInputs: refs(0, 10), controls: [select('resolution', 'Resolution', ['1k', '768sq', '1.5k', '2k', '4k']), boolean('grounding', 'Web research before generating', false)] },
  { id: 'comfy-flux-3-video', name: 'FLUX 3 Video', kind: 'video', upstreamModelId: 'bfl/flux-3-video', studioTasks: ['video-generate'], aspectRatios: ['auto', '16:9', '9:16', '1:1', '4:3', '3:4', '21:9', '2:1'], defaultAspectRatio: '16:9', durations: seconds([5, 6, 8, 10, 12, 15, 20]), defaultDuration: '5s', referenceInputs: refs(0, 10), controls: [select('resolution', 'Resolution', ['hd', 'fhd', 'qhd', 'uhd']), boolean('generate_audio', 'Generate audio')] },
  { id: 'comfy-ltx-2-5-pro', name: 'LTX 2.5 Pro', kind: 'video', upstreamModelId: 'ltx/ltx-2-5-pro', studioTasks: ['video-generate'], aspectRatios: ['16:9', '9:16'], defaultAspectRatio: '16:9', durations: seconds([2, 4, 6, 8, 10]), defaultDuration: '6s', controls: [select('resolution', 'Resolution', ['1080p', '720p']), select('fps', 'Frame rate', ['25', '24', '48', '50']), boolean('generate_audio', 'Generate audio')] },
  { id: 'comfy-ltx-2-5-fast', name: 'LTX 2.5 Fast', kind: 'video', upstreamModelId: 'ltx/ltx-2-5-fast', studioTasks: ['video-generate'], aspectRatios: ['16:9', '9:16'], defaultAspectRatio: '16:9', durations: seconds([2, 4, 6, 8, 10]), defaultDuration: '6s', controls: [select('resolution', 'Resolution', ['1080p', '720p', '1440p', '2160p']), select('fps', 'Frame rate', ['25', '24', '48', '50']), boolean('generate_audio', 'Generate audio')] },
  { id: 'comfy-minimax-h3', name: 'MiniMax H3', kind: 'video', upstreamModelId: 'minimax/minimax-h3', studioTasks: ['video-generate'], aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'], defaultAspectRatio: '16:9', durations: seconds([4, 5, 6, 8, 10, 12, 15]), defaultDuration: '6s', referenceInputs: refs(0, 2), controls: [select('resolution', 'Resolution', ['768P', '2K'])] },
];
const LTX_SIZES = { '720p': [1280, 720], '1080p': [1920, 1080], '1440p': [2560, 1440], '2160p': [3840, 2160] };
export function profileFor(id) {
  const profile = profiles.find(item => item.id === id);
  if (!profile) throw Error('Unknown Comfy Router model');
  return profile;
}
export function optionsFor(profile, input) {
  const options = Object.fromEntries(profile.controls.map(control => [control.key, control.default]));
  for (const [key, value] of Object.entries(input.options ?? {})) {
    const control = profile.controls.find(item => item.key === key);
    if (!control || (control.type === 'boolean' ? typeof value !== 'boolean' : !control.choices.some(choice => choice.value === value))) throw Error('Invalid Comfy Router option: ' + key);
    options[key] = value;
  }
  return options;
}
/** Validates everything before media is read or credits are reserved. */
export function checkInput(profile, input) {
  const prompt = input.prompt?.trim() ?? '';
  if (!prompt || prompt.length > 10000) throw Error('Enter a prompt of 1–10000 characters');
  const images = input.imageUrls ?? [];
  const range = profile.referenceInputs?.image ?? { min: 0, max: 0 };
  if (!Array.isArray(images) || images.length < range.min || images.length > range.max) throw Error('Check the image reference count for ' + profile.name);
  if ((input.videoUrls ?? []).length || (input.audioUrls ?? []).length || input.maskUrl) throw Error(profile.name + ' accepts only image references');
  if (input.aspectRatio && !profile.aspectRatios.includes(input.aspectRatio)) throw Error('Unsupported aspect ratio');
  if (input.duration && !profile.durations?.includes(input.duration)) throw Error('Unsupported video length');
  return { prompt, images, options: optionsFor(profile, input), aspect: input.aspectRatio ?? profile.defaultAspectRatio, seconds: parseInt(input.duration ?? profile.defaultDuration ?? '0', 10) };
}
/** Builds the native Router body. Images are sent inline: base64 for FLUX, data URIs for MiniMax. */
export function buildBody(profile, checked, images) {
  const { prompt, options, aspect, seconds } = checked;
  switch (profile.upstreamModelId) {
    case 'bfl/flux-3-image':
      return { prompt, aspect_ratio: aspect, resolution: options.resolution, grounding: options.grounding, ...(images.length ? { images: images.map(image => image.base64) } : {}) };
    case 'bfl/flux-3-video':
      return { mode: images.length ? 'i2v' : 't2v', prompt, aspect_ratio: aspect, duration: seconds, resolution: options.resolution, generate_audio: options.generate_audio, ...(images.length ? { keyframes: images.map(image => image.base64) } : {}) };
    case 'ltx/ltx-2-5-pro': case 'ltx/ltx-2-5-fast': {
      const [width, height] = LTX_SIZES[options.resolution];
      return { prompt, duration: seconds, fps: Number(options.fps), generate_audio: options.generate_audio, resolution: aspect === '9:16' ? height + 'x' + width : width + 'x' + height };
    }
    case 'minimax/minimax-h3':
      return { content: [{ type: 'text', text: prompt }, ...images.map((image, index) => ({ type: 'image_url', role: index ? 'last_frame' : 'first_frame', image_url: { url: 'data:' + image.mimeType + ';base64,' + image.base64 } }))], duration: seconds, resolution: options.resolution, ratio: images.length ? 'adaptive' : aspect };
    default: throw Error('Unsupported Comfy Router model');
  }
}
/** Each partner returns its own native document; only the documented media field is read. */
export function outputUrl(profile, data) {
  switch (profile.upstreamModelId) {
    case 'bfl/flux-3-image': case 'bfl/flux-3-video':
      if (data?.result?.sample) return data.result.sample;
      throw Error('FLUX finished without a sample (' + String(data?.status ?? 'unknown').slice(0, 60) + ')');
    case 'ltx/ltx-2-5-pro': case 'ltx/ltx-2-5-fast':
      if (data?.result?.video_url) return data.result.video_url;
      throw Error('LTX finished without a video (' + String(data?.error?.type ?? data?.status ?? 'unknown').slice(0, 60) + ')');
    case 'minimax/minimax-h3':
      if (data?.task?.content?.url) return data.task.content.url;
      throw Error('MiniMax finished without a video (' + String(data?.task?.status ?? 'unknown').slice(0, 60) + ')');
    default: throw Error('Unsupported Comfy Router model');
  }
}
export function providerManifest() {
  return { schemaVersion: 1, kind: 'viral-hit-provider', id: 'comfy', label: 'Comfy', description: 'Comfy Router with one Comfy API key: FLUX 3 image and video, LTX 2.5 and MiniMax H3. Usage is billed to your Comfy account.', scope: 'general', author: 'Viral Hit contributors', license: 'Apache-2.0', referenceDelivery: 'project-media', configurationDelivery: 'request', connectionTest: true, entry: 'provider.mjs', environment: ['COMFY_API_KEY'], models: profiles };
}
