import { dataUri } from './controls.mjs';

const frames = (images, mode, first, last, reference) => images.map((image, index) => ({
  image, role: mode === 'references' ? reference : index ? last : first,
}));

/** Never sends file-system paths or an owned-media URL to a remote provider. */
export function buildVideoBody(profile, checked, images, audios) {
  const { prompt, options, aspect, seconds } = checked, id = profile.upstreamModelId;
  if (id.startsWith('byteplus/')) {
    return {
      content: [
        { type: 'text', text: prompt },
        ...frames(images, options.reference_mode, 'first_frame', 'last_frame', 'reference_image').map(({ image, role }) =>
          ({ type: 'image_url', role, image_url: { url: dataUri(image) } })),
        ...audios.map(audio => ({ type: 'audio_url', role: 'reference_audio', audio_url: { url: dataUri(audio) } })),
      ],
      duration: seconds, ratio: aspect === 'auto' || (id.includes('2-5-') && images.length && options.reference_mode === 'frames') ? 'adaptive' : aspect,
      resolution: options.resolution, generate_audio: options.generate_audio, watermark: false,
    };
  }
  if (id.startsWith('veo/')) {
    const image = item => ({ bytesBase64Encoded: item.base64, mimeType: item.mimeType });
    return {
      instances: [{ prompt, ...(images[0] ? { image: image(images[0]) } : {}), ...(images[1] ? { lastFrame: image(images[1]) } : {}) }],
      parameters: { aspectRatio: aspect, durationSeconds: seconds, resolution: options.resolution, generateAudio: options.generate_audio,
        enhancePrompt: options.enhance_prompt, sampleCount: 1 },
    };
  }
  if (id.startsWith('kling/')) return {
    prompt, aspect_ratio: aspect, duration: String(seconds), mode: options.mode, sound: options.sound, multi_shot: false,
    ...(images.length ? { image_list: images.map((image, index) => ({
      image_url: image.base64, ...(options.reference_mode === 'references' ? {} : { type: index ? 'end_frame' : 'first_frame' }),
    })) } : {}),
  };
  if (id.startsWith('wan/')) return {
    input: { prompt, ...(images.length ? { media: frames(images, options.reference_mode, 'first_frame', 'last_frame', 'reference_image')
      .map(({ image, role }) => ({ type: role, url: dataUri(image) })) } : {}) },
    parameters: { duration: seconds, ratio: aspect === 'auto' ? 'adaptive' : aspect, resolution: options.resolution,
      audio: options.generate_audio, prompt_extend: options.enhance_prompt, watermark: false },
  };
  if (id.startsWith('xai/')) return {
    prompt, aspect_ratio: aspect, duration: seconds,
    ...(images.length ? options.reference_mode === 'references'
      ? { reference_images: images.map(image => ({ url: dataUri(image) })) }
      : { image: { type: 'image_url', url: dataUri(images[0]) } } : {}),
  };
  throw Error('Unsupported Comfy Router video model');
}
