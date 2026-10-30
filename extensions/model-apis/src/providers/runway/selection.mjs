// Curated Runway Dev models. `pnpm sync` reads their per-model request schemas from Runway's OpenAPI document.
const e = (path, model, name, kind, tasks, extra = {}) => ({ path, endpoint: path.replace('/v1/', '') + '/' + model, model, name, kind, tasks, fixed: { model }, ...extra });
const videos = [['gen4.5', 'Gen-4.5'], ['veo3.1', 'Veo 3.1'], ['veo3.1_fast', 'Veo 3.1 Fast'], ['seedance2_5', 'Seedance 2.5'], ['kling_4', 'Kling 4'], ['hailuo3', 'Hailuo 3'], ['wan3', 'Wan 3'], ['h3_max', 'MiniMax H3 Max'], ['grok_imagine_1_5', 'Grok Imagine 1.5'], ['gemini_omni_flash_1.1', 'Gemini Omni Flash 1.1']];
export const selection = [
  ...videos.map(([model, name]) => e('/v1/text_to_video', model, name + ' · Runway', 'video', ['video-generate'])),
  ...videos.map(([model, name]) => e('/v1/image_to_video', model, name + ' · Image to video · Runway', 'video', ['video-generate'])),
  e('/v1/video_to_video', 'aleph2', 'Aleph 2 · Video edit · Runway', 'video', ['video-edit', 'restyle']),
  e('/v1/video_to_video', 'klingO3_pro', 'Kling O3 · Video edit · Runway', 'video', ['video-edit']),
  ...[['gen4_image', 'Gen-4 Image'], ['gpt_image_2_5_sunburst', 'GPT Image 2.5 Sunburst'], ['nano_banana_2.1', 'Nano Banana 2.1'], ['gemini_image3_pro', 'Nano Banana Pro'], ['seedream5_pro', 'Seedream 5 Pro'], ['ideogram_4_5', 'Ideogram 4.5'], ['grok_imagine_image_2', 'Grok Imagine Image 2']]
    .map(([model, name]) => e('/v1/text_to_image', model, name + ' · Runway', 'image', ['image-generate', 'image-edit'])),
  e('/v1/image_upscale', 'magnific_precision_upscaler_v2', 'Magnific image upscale · Runway', 'image', ['image-upscale']),
  e('/v1/video_upscale', 'magnific_video_upscaler_creative', 'Magnific video upscale · Runway', 'video', ['video-upscale']),
  e('/v1/character_performance', 'act_two', 'Act-Two · Character performance · Runway', 'video', ['motion-transfer'], { media: { character: 'image', reference: 'video' } }),
  e('/v1/sound_effect', 'eleven_text_to_sound_v2', 'Sound effect · Runway', 'audio', ['audio-generate']),
];
