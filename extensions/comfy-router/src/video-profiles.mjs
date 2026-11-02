import { boolean, refs, referenceMode, seconds, select } from './controls.mjs';

const wide = ['16:9', '9:16', '1:1', '4:3', '3:4'];
const video = (id, name, upstreamModelId, aspectRatios, durations, maxImages, controls, audio = 0) => ({
  id: 'comfy-' + id, name, upstreamModelId, kind: 'video', studioTasks: ['video-generate'],
  aspectRatios, defaultAspectRatio: '16:9', durations: seconds(durations), defaultDuration: '6s',
  referenceInputs: refs(0, maxImages, audio), controls,
});

/** Canonical Router IDs and supported subsets of their native schemas, checked 2026-11-02. */
export const videoProfiles = [
  ...[
    ['seedance-2.5', 'Seedance 2.5', 'dreamina-seedance-2-5-260628'],
    ['seedance-2.0', 'Seedance 2.0', 'dreamina-seedance-2-0-260128'],
    ['seedance-2.0-fast', 'Seedance 2.0 Fast', 'dreamina-seedance-2-0-fast-260128'],
    ['seedance-2.0-mini', 'Seedance 2.0 Mini', 'dreamina-seedance-2-0-mini'],
  ].map(([id, name, upstream]) => video(id, name, 'byteplus/' + upstream, [...wide, '21:9', '9:21', 'auto'],
    id === 'seedance-2.5' ? [4, 5, 6, 8, 10, 12, 15, 20, 25, 30] : [4, 5, 6, 8, 10, 12, 15], 9,
    [select('resolution', 'Resolution', id === 'seedance-2.5' ? ['720p', '1080p', '480p'] : ['720p', '480p']), boolean('generate_audio'), referenceMode()], 1)),
  ...[
    ['veo-3.1', 'Veo 3.1', 'veo-3.1-generate-001'],
    ['veo-3.1-fast', 'Veo 3.1 Fast', 'veo-3.1-fast-generate-001'],
    ['veo-3.1-lite', 'Veo 3.1 Lite', 'veo-3.1-lite-generate-001'],
  ].map(([id, name, upstream]) => video(id, name, 'veo/' + upstream, ['16:9', '9:16'], [4, 6, 8], 2,
    [select('resolution', 'Resolution', ['720p', '1080p', '4k']), boolean('generate_audio'), boolean('enhance_prompt', 'Enhance prompt', false)])),
  ...[
    ['kling-v3-omni', 'Kling V3 Omni', 'kling-v3-omni', 2],
    ['kling-o1', 'Kling O1', 'kling-video-o1', 2],
    ['kling-v3', 'Kling V3', 'kling-v3', 0],
  ].map(([id, name, upstream, max]) => video(id, name, 'kling/' + upstream, ['16:9', '9:16', '1:1'], [3, 4, 5, 6, 8, 10, 12, 15], max,
    [select('mode', 'Quality', ['pro', 'std']), select('sound', 'Generate audio', ['off', 'on']), ...(max ? [referenceMode()] : [])])),
  ...[
    ['wan-3.0', 'Wan 3.0', 'wan3.0-video'], ['wan-3.0-prime', 'Wan 3.0 Prime', 'wan3.0-video-prime'],
  ].map(([id, name, upstream]) => video(id, name, 'wan/' + upstream, [...wide, 'auto'], [2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30], 10,
    [select('resolution', 'Resolution', ['1080P', '720P', '480P']), boolean('generate_audio'), boolean('enhance_prompt', 'Enhance prompt', false), referenceMode()])),
  ...[
    ['grok-imagine-video-1.5', 'Grok Imagine Video 1.5', 'grok-imagine-video-1.5'],
    ['grok-imagine-video-1.5-lite', 'Grok Imagine Video 1.5 Lite', 'grok-imagine-video-1.5-lite'],
  ].map(([id, name, upstream]) => video(id, name, 'xai/' + upstream, [...wide, '3:2', '2:3'], [2, 3, 4, 5, 6, 8, 10, 12, 15], 4,
    [referenceMode()])),
];
