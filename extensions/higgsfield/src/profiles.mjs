const resolution = values => ({ key: 'resolution', label: 'Resolution', type: 'select', default: '720p', choices: values.map(value => ({ value, label: value })) });
const boolean = (key, label) => ({ key, label, type: 'boolean', default: true });
const ratios = ['16:9', '4:3', '1:1', '3:4', '9:16'];
export const mediaHosts = ['d28lhcrx5qdowv.cloudfront.net'];
export const profiles = [
  { id: 'higgsfield-soul-2', name: 'Soul 2', kind: 'image', upstreamModelId: 'higgsfield-ai/soul/v2/standard', studioTasks: ['image-generate'], aspectRatios: [...ratios, '2:3', '3:2'], defaultAspectRatio: '1:1', controls: [resolution(['720p', '1080p']), boolean('enhance_prompt', 'Enhance prompt')] },
  { id: 'higgsfield-seedance-2', name: 'Seedance 2.0', kind: 'video', upstreamModelId: 'bytedance/seedance-2.0/text-to-video', studioTasks: ['video-generate'], aspectRatios: [...ratios, '21:9'], defaultAspectRatio: '16:9', durations: Array.from({ length: 12 }, (_, i) => (i + 4) + 's'), defaultDuration: '5s', controls: [resolution(['480p', '720p', '1080p', '4k']), boolean('generate_audio', 'Generate audio')] },
  ...['motion-transfer', 'object-swap'].map(mode => ({ id: 'higgsfield-genjutsu-' + mode, name: 'Genjutsu · ' + (mode === 'motion-transfer' ? 'Motion transfer' : 'Object swap'), kind: 'video', upstreamModelId: 'higgsfield/genjutsu/' + mode + '/v1.0', studioTasks: [mode], aspectRatios: ['auto'], referenceInputs: { image: { min: 1, max: 8 }, video: { min: 1, max: 1 }, audio: { min: 0, max: 0 } }, controls: [resolution(['480p', '720p', '1080p'])] })),
];
export function providerManifest() {
  return { schemaVersion: 1, kind: 'viral-hit-provider', id: 'higgsfield', label: 'Higgsfield', description: 'Direct Higgsfield API: Soul 2, Seedance 2.0, Genjutsu motion transfer and object swap. A separate Higgsfield API account and balance are required.', scope: 'general', author: 'Viral Hit contributors', license: 'Apache-2.0', referenceDelivery: 'project-media', configurationDelivery: 'request', connectionTest: true, entry: 'provider.mjs', mediaHosts, environment: ['HIGGSFIELD_API_KEY'], models: profiles };
}
export function profileFor(id) {
  const profile = profiles.find(model => model.id === id);
  if (!profile) throw Error('Unknown Higgsfield model');
  return profile;
}
export function buildPayload(model, input) {
  const profile = profileFor(model.id), prompt = input.prompt?.trim();
  if (!prompt || prompt.length > 10000) throw Error('Enter a prompt of 1–10000 characters');
  const options = Object.fromEntries(profile.controls.map(control => [control.key, control.default]));
  for (const [key, value] of Object.entries(input.options ?? {})) {
    const control = profile.controls.find(item => item.key === key);
    if (!control || (control.type === 'boolean' ? typeof value !== 'boolean' : !control.choices.some(choice => choice.value === value))) throw Error('Invalid Higgsfield model option');
    options[key] = value;
  }
  const refs = { image: input.imageUrls ?? [], video: input.videoUrls ?? [], audio: input.audioUrls ?? [] };
  for (const [kind, urls] of Object.entries(refs)) {
    const range = profile.referenceInputs?.[kind] ?? { min: 0, max: 0 };
    if (!Array.isArray(urls) || urls.length < range.min || urls.length > range.max || urls.some(url => typeof url !== 'string' || !url)) throw Error('Check the ' + kind + ' reference count');
  }
  if (input.maskUrl) throw Error('This Higgsfield model does not accept a mask');
  if (input.aspectRatio && !profile.aspectRatios.includes(input.aspectRatio)) throw Error('Unsupported aspect ratio');
  if (input.duration && !profile.durations?.includes(input.duration)) throw Error('Unsupported video length');
  if (profile.referenceInputs) return { prompt, ...options, video_url: refs.video[0], image_urls: refs.image };
  return { prompt, ...options, aspect_ratio: input.aspectRatio ?? profile.defaultAspectRatio, ...(profile.kind === 'image' ? { batch_size: 1 } : { duration: parseInt(input.duration ?? profile.defaultDuration, 10) }) };
}
