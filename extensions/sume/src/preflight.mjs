/** Read-only catalog check before any upload or paid submit. The server remains authoritative. */
export async function checkModel(api, profile, body) {
  const family = { image: 'image', video: 'video', lipsync: 'video', dubbing: 'video', music: 'music', speech: 'tts' }[profile.route];
  if (!family) return;
  const { model } = await api.request('/v1/' + family + '-router/models/' + encodeURIComponent(body.model));
  if (!model || model.id !== body.model || !model.capabilities) throw Error('Sume model catalog did not confirm this model');
  const caps = model.capabilities;
  for (const [key, choices] of [['aspect_ratio', 'aspect_ratios'], ['resolution', 'resolutions'], ['quality', 'qualities'], ['language', 'languages']]) {
    if (body[key] && Array.isArray(caps[choices]) && !caps[choices].includes(body[key])) throw Error('Sume model does not currently support the selected ' + key);
  }
  if (body.image_urls?.length && caps.image_edit === false) throw Error('This Sume model currently accepts text only');
  for (const [field, capability] of [['image_url', 'image_to_video'], ['end_image_url', 'end_frame'], ['reference_image_urls', 'reference_images'], ['reference_video_urls', 'reference_videos']]) {
    if (family === 'video' && body[field] && caps[capability] === false) throw Error('This Sume model does not currently support ' + capability);
  }
  const limit = family === 'tts' ? caps.max_characters : caps.max_prompt_characters;
  if (Number.isFinite(limit) && (body.transcript ?? body.prompt ?? '').length > limit) throw Error('Text exceeds this Sume model’s current limit');
  const lengths = caps.duration_seconds;
  if (body.duration && lengths && !Array.isArray(lengths) && (body.duration < lengths.min || body.duration > lengths.max)) throw Error('Sume model does not currently support the selected length');
  if (body.duration && Array.isArray(lengths) && !lengths.includes(body.duration)) throw Error('Sume model does not currently support the selected length');
}
