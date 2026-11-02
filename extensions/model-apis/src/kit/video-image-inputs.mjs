/** Project only explicit frame fields/keyframes and reference arrays from a native request binding. */
export function describeVideoImages({ model, binding }) {
  if (model.kind !== 'video') return model;
  const images = binding.media.filter(slot => slot.kind === 'image');
  let frames = 0, references = 0;
  for (const slot of images) {
    if (slot.shape === 'keyframes') frames += Math.min(2, slot.max);
    else if (!slot.many && (/first|last|end|start/i.test(slot.field) || slot.field === 'image_url' && /image-to-video|image_to_video/.test(binding.endpoint))) frames += 1;
    else if (slot.many && !/middle|keyframe/i.test(slot.field)) references += slot.max;
  }
  const max = model.referenceInputs?.image.max ?? 0;
  // The generic request builder fills scalar frame slots first. A mixed endpoint is therefore
  // frame-only here until its adapter exposes an explicit switch for the reference-only case.
  const modes = { ...(frames && max ? { frames: Math.min(frames, max, 2) } : {}), ...(!frames && references && max ? { references: Math.min(references, max) } : {}) };
  return Object.keys(modes).length ? { ...model, videoImageInputs: modes } : model;
}
