import { profiles } from './profiles.mjs';
export function profileFor(id) { const profile = profiles.find(item => item.id === id); if (!profile) throw Error('Unknown Sume model'); return profile; }
/** Build before uploading: reject invalid options before sending media or reserving credits. */
export function buildPayload(profile, input) {
  const options = Object.fromEntries((profile.controls ?? []).map(control => [control.key, control.default]));
  for (const [key, value] of Object.entries(input.options ?? {})) {
    const control = profile.controls?.find(item => item.key === key);
    if (!control || (control.type === 'select' && !control.choices.some(choice => choice.value === value)) || (control.type === 'number' && (!Number.isFinite(value) || value < control.min || value > control.max)) || (control.type === 'boolean' && typeof value !== 'boolean') || (control.type === 'string' && (typeof value !== 'string' || value.length > control.maxLength))) throw Error('Invalid Sume option: ' + key);
    options[key] = value;
  }
  const images = input.imageUrls ?? [], videos = input.videoUrls ?? (input.videoUrl ? [input.videoUrl] : []), audio = input.audioUrls ?? [];
  for (const [kind, urls] of Object.entries({ image: images, video: videos, audio })) { const { min, max } = profile.referenceInputs[kind]; if (!Array.isArray(urls) || urls.length < min || urls.length > max || urls.some(url => typeof url !== 'string' || !url)) throw Error('Check the ' + kind + ' references for ' + profile.name); }
  if (input.maskUrl && (!profile.maskInput || !images.length)) throw Error('This model needs a reference image for its mask');
  if (input.aspectRatio && !profile.aspectRatios.includes(input.aspectRatio)) throw Error('Unsupported aspect ratio');
  if (input.duration && !profile.durations?.includes(input.duration)) throw Error('Unsupported video length');
  const prompt = input.prompt?.trim() ?? '', body = { mode: 'async' };
  if (['image', 'video', 'music', 'speech'].includes(profile.route) && !prompt) throw Error('Enter a prompt or script');
  const duration = parseInt(input.duration ?? profile.defaultDuration, 10);
  const aspect = input.aspectRatio ?? profile.aspectRatios[0];
  const path = {
    image: '/v1/image-router/generate', video: '/v1/video-router/generate', music: '/v1/music-router/generate', speech: '/v1/tts-router/generate',
    remix: '/v1/sume/remix/' + profile.remixMode + '/v1.0', restyle: '/v1/sume/remix/restyle/v1.0', motion: '/v1/kling/3.0/motion-control',
    lipsync: '/v1/video-router/generate', dubbing: '/v1/video-router/generate', captions: '/v1/video-captions', upscale: '/v1/video-upscale-1.0/upscale',
    background: '/v1/rmbg-1.0/remove', trim: '/v1/video-trim', detach: '/v1/audio-detach',
  }[profile.route];
  switch (profile.route) {
    case 'image': Object.assign(body, { model: profile.upstreamModelId, prompt, aspect_ratio: aspect, ...options }, images.length ? { image_urls: images } : {}, input.maskUrl ? { mask_image_url: input.maskUrl } : {}); break;
    case 'video':
      Object.assign(body, { model: profile.upstreamModelId, prompt, aspect_ratio: aspect, duration, ...options });
      if (profile.frameMode) { if (images[0]) body.image_url = images[0]; if (images[1]) body.end_image_url = images[1]; }
      else { if (images.length) body.reference_image_urls = images; if (videos.length) body.reference_video_urls = videos; }
      break;
    case 'remix': Object.assign(body, { video_url: videos[0], image_urls: images, resolution: options.resolution }, prompt ? { prompt } : {}); break;
    case 'restyle': Object.assign(body, { video_url: videos[0], ...options }, prompt ? { prompt } : {}); break;
    case 'motion': Object.assign(body, { image_url: images[0], motion_video_url: videos[0], duration_seconds: options.source_seconds, character_orientation: options.orientation, keep_original_sound: options.keep_sound }, prompt ? { prompt } : {}); break;
    case 'lipsync': Object.assign(body, { model: profile.upstreamModelId, audio_url: audio[0], duration: Math.ceil(options.source_seconds) }, images.length ? { image_url: images[0] } : { video_url: videos[0] }); break;
    case 'dubbing': Object.assign(body, { model: 'veed-dubbing', video_url: videos[0], duration: Math.ceil(options.source_seconds), dubbing: { target_language: options.language } }); break;
    case 'captions': Object.assign(body, { video_url: videos[0], style: options.style, language: options.language }); if (options.language === 'ko' && ['slam', 'punch', 'tiktok-green'].includes(options.style)) throw Error('Choose a Hangul caption style for Korean speech'); break;
    case 'upscale': Object.assign(body, { video_url: videos[0], resolution: options.resolution, enhancement_tier: options.tier }); break;
    case 'background': body.image_url = images[0]; break;
    case 'trim': Object.assign(body, { video_url: videos[0], start: options.start, duration: options.length, precision: 'exact', audio: 'keep' }); break;
    case 'detach': Object.assign(body, { video_url: videos[0], format: 'wav' }); break;
    case 'music': Object.assign(body, { model: profile.upstreamModelId, prompt }); break;
    case 'speech':
      if (!/^(?:[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}|voi_[a-fA-F0-9]{32})$/.test(options.voice_id)) throw Error('Choose a Sume voice ID from your Sume voice library');
      Object.assign(body, { model: options.engine, transcript: prompt, voice: { mode: 'id', id: options.voice_id }, language: options.language }); break;
    default: throw Error('Unsupported Sume operation');
  }
  return { path, body };
}
export async function uploadPayload(body, upload) {
  const values = new Map();
  const map = async value => { if (!values.has(value)) values.set(value, await upload(value)); return values.get(value); };
  const result = { ...body };
  for (const key of ['image_url', 'end_image_url', 'video_url', 'audio_url', 'motion_video_url', 'mask_image_url']) if (result[key]) result[key] = await map(result[key]);
  for (const key of ['image_urls', 'reference_image_urls', 'reference_video_urls']) if (result[key]) { const mapped = []; for (const value of result[key]) mapped.push(await map(value)); result[key] = mapped; }
  return result;
}
