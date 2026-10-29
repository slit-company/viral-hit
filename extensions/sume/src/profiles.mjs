const select = (key, label, values, initial = values[0]) => ({ key, label, type: 'select', default: initial, choices: values.map(value => ({ value, label: value })) });
const number = (key, label, value, min, max) => ({ key, label, type: 'number', default: value, min, max });
const string = (key, label, value = '') => ({ key, label, type: 'string', default: value, maxLength: 128 });
const refs = (image = [0, 0], video = [0, 0], audio = [0, 0]) => Object.fromEntries(Object.entries({ image, video, audio }).map(([k, [min, max]]) => [k, { min, max }]));
const ratios = ['1:1', '16:9', '9:16'];
const sourceLength = number('source_seconds', 'Source length in seconds (round up)', 5, 2, 60);
const resolutions = (values, initial) => select('resolution', 'Resolution', values, initial);
const base = (id, name, kind, route, extra = {}) => ({ id: 'sume-' + id, name, kind, route, aspectRatios: kind === 'audio' ? [] : ['auto'], referenceInputs: refs(), ...extra });
const image = (id, name, count, controls = []) => base(id, name, 'image', 'image', { upstreamModelId: id, aspectRatios: ratios, referenceInputs: refs([0, count]), ...(controls.length ? { controls } : {}) });
const video = (id, name, length, extra = {}) => base(id, name, 'video', 'video', { upstreamModelId: id, aspectRatios: ratios, durations: length.map(v => v + 's'), defaultDuration: length[0] + 's', ...extra });
export const restyles = ['cel-shaded-cg-anime', 'chunky-textured-low-poly', 'comic-3d', 'expressive-2d-animation', 'expressive-gouache-fashion', 'felt-puppet-stop-motion', 'graphic-cel', 'grotesque-street-cgi', 'hand-painted-cel-animation', 'knitted-yarn-world', 'neon-graphic-cinematic-3d', 'nighttime-anime-pixel-art', 'outline-free-cel', 'painterly-cinematic-3d', 'painterly-sculpted-animation', 'retro-game-3d', 'rounded-toy-cgi', 'sculptural-3d-fashion', 'textured-gouache-character-illustration', 'warm-painterly-3d-animation'];
export const profiles = [
  { ...image('gpt-image-2', 'GPT Image 2 · Sume', 4, [select('quality', 'Quality', ['low', 'medium', 'high'], 'medium')]), maskInput: { required: false } },
  image('gpt-image-2.5', 'GPT Image 2.5 · Sume', 4, [select('quality', 'Quality', ['auto', 'low', 'medium', 'high', 'xhigh', 'max'])]),
  image('nano-banana-2.1', 'Nano Banana 2.1 · Sume', 4, [resolutions(['1K', '2K', '4K'])]),
  image('seedream-5-lite', 'Seedream 5 Lite · Sume', 4),
  image('higgsfield-soul', 'Higgsfield Soul · Sume', 0, [resolutions(['720p', '1080p'])]),
  video('seedance-2.5', 'Seedance 2.5 · references', [4, 5, 8, 10, 15, 20, 30], { referenceInputs: refs([0, 8], [0, 3]), controls: [resolutions(['480p', '720p', '1080p'], '720p')] }),
  video('seedance-2.5-frames', 'Seedance 2.5 · first/last frame', [4, 5, 8, 10, 15, 20, 30], { upstreamModelId: 'seedance-2.5', frameMode: true, referenceInputs: refs([1, 2]), controls: [resolutions(['480p', '720p', '1080p'], '720p')] }),
  video('kling-3', 'Kling 3 · Sume', [5, 10], { frameMode: true, referenceInputs: refs([0, 1]), controls: [resolutions(['1080p'])] }),
  video('veo-3.1', 'Veo 3.1 · Sume', [4, 6, 8], { frameMode: true, referenceInputs: refs([0, 1]), controls: [resolutions(['720p', '1080p'])] }),
  video('grok-imagine-video-1.5', 'Grok Imagine Video 1.5 · Sume', [5, 10], { frameMode: true, referenceInputs: refs([1, 1]), controls: [resolutions(['480p', '720p'], '720p')] }),
  ...['motion-transfer', 'object-swap'].map(mode => base('remix-' + mode, 'Sume Remix · ' + mode, 'video', 'remix', { remixMode: mode, referenceInputs: refs([1, 8], [1, 1]), controls: [resolutions(['480p', '720p', '1080p'], '720p')] })),
  base('remix-restyle', 'Sume Remix · restyle', 'video', 'restyle', { referenceInputs: refs([0, 0], [1, 1]), controls: [select('preset_id', 'Visual style', restyles), resolutions(['480p', '720p', '1080p'], '720p')] }),
  base('motion-control', 'Kling 3 · motion control', 'video', 'motion', { referenceInputs: refs([1, 1], [1, 1]), controls: [number('source_seconds', 'Motion clip length in seconds', 5, 1, 30), select('orientation', 'Character orientation', ['video', 'image']), { key: 'keep_sound', label: 'Keep original sound', type: 'boolean', default: true }] }),
  ...[['veed-fabric-1.0', 'Portrait lip sync', true], ['sync-lipsync-3', 'Video lip sync', false]].map(([id, name, portrait]) => base(id, name + ' · Sume', 'video', 'lipsync', { upstreamModelId: id, referenceInputs: refs(portrait ? [1, 1] : [0, 0], portrait ? [0, 0] : [1, 1], [1, 1]), controls: [sourceLength] })),
  base('dubbing', 'Translate and lip sync · Sume', 'video', 'dubbing', { upstreamModelId: 'veed-dubbing', referenceInputs: refs([0, 0], [1, 1]), controls: [number('source_seconds', 'Source length in seconds (round up)', 5, 2, 600), select('language', 'Target language', ['ko', 'en', 'ja', 'zh', 'es', 'fr', 'de', 'pt', 'it'], 'ko')] }),
  base('captions', 'Animated captions · Sume', 'video', 'captions', { referenceInputs: refs([0, 0], [1, 1]), controls: [select('style', 'Caption style', ['korean-ad', 'weight-shift', 'black-outline', 'highlight', 'pill-karaoke', 'clip-wipe', 'editorial-emphasis', 'slam', 'punch', 'tiktok-green']), select('language', 'Speech language', ['auto', 'ko', 'en', 'ja', 'es'])] }),
  base('upscale', 'Video upscale · Sume', 'video', 'upscale', { referenceInputs: refs([0, 0], [1, 1]), controls: [resolutions(['1080p', '2K', '4K']), select('tier', 'Enhancement', ['fast', 'standard', 'pro'], 'standard')] }),
  base('remove-background', 'Remove image background · Sume', 'image', 'background', { referenceInputs: refs([1, 1]) }),
  base('trim', 'Trim video · Sume', 'video', 'trim', { referenceInputs: refs([0, 0], [1, 1]), controls: [number('start', 'Start (seconds)', 0, 0, 3600), number('length', 'Length (seconds)', 5, .2, 900)] }),
  base('detach-audio', 'Extract audio · Sume', 'audio', 'detach', { referenceInputs: refs([0, 0], [1, 1]) }),
  ...['lyria-3.5', 'lyria-3-pro', 'elevenlabs-music-2.5', 'minimax-music-2.6', 'lyria-2', 'stable-audio-2.5', 'ace-step'].map(id => base('music-' + id, id + ' · music', 'audio', 'music', { upstreamModelId: id })),
  base('speech', 'Speech · Sume', 'audio', 'speech', { controls: [select('engine', 'Voice model', ['eleven-multilingual-v2', 'eleven-v4', 'sonic-3.6', 'minimax-speech-2.8-hd']), string('voice_id', 'Sume voice ID'), select('language', 'Language', ['ko', 'en', 'ja', 'zh', 'es', 'fr', 'de'], 'ko')] }),
];
const studioTasks = profile => ({ image: ['image-generate', ...(profile.referenceInputs.image.max ? ['image-edit'] : [])], video: ['video-generate'], remix: [profile.remixMode], restyle: ['restyle'], motion: ['motion-control'], lipsync: [profile.referenceInputs.image.min ? 'image-lipsync' : 'video-lipsync'], dubbing: ['video-dubbing'], captions: ['video-caption'], upscale: ['video-upscale'], background: ['remove-background'], trim: ['video-edit'], detach: ['audio-generate'], music: ['music-generate'], speech: ['text-to-speech'] })[profile.route];
export function providerManifest() {
  return { schemaVersion: 1, kind: 'viral-hit-provider', id: 'sume', label: 'Sume', description: 'Image, video, Remix, lip sync, speech, music and media editing through the Sume API. Model availability and charges depend on your Sume account.', scope: 'general', author: 'Viral Hit contributors', license: 'Apache-2.0', referenceDelivery: 'project-media', configurationDelivery: 'request', connectionTest: true, entry: 'provider.mjs', mediaHosts: ['media.sume.com'], environment: ['SUME_API_KEY'], models: profiles.map(({ route, frameMode, remixMode, referenceInputs, ...model }) => ({ ...model, studioTasks: studioTasks({route,remixMode,referenceInputs}), ...(Object.values(referenceInputs).some(range => range.max > 0) ? { referenceInputs } : {}) })) };
}
