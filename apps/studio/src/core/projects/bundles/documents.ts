import { inspectStoryboardAttachment } from '@/core/storyboards/portable.server';
import { bundleManifest, type BundleManifest } from './contract';

/** Every media pointer becomes a manifest identity; free-text prompts are not rewritten. */
export function mapBundleDocuments(input: BundleManifest, projectId: string, assets: Map<string, string>, portable: boolean) {
  const source = bundleManifest.parse(input);
  const assetId = (id: string | null | undefined) => {
    if (!id) return null;
    const mapped = assets.get(id); if (!mapped) throw Error(`Project file references missing media: ${id}`);
    return mapped;
  };
  const url = (id: string) => portable ? `viralhit:asset:${id}` : `/api/app/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(id)}`;
  const timeline = source.timeline ? {
    ...source.timeline, projectId, lastRenderAssetId: null, lastRenderUrl: null,
    tracks: source.timeline.tracks.map(track => ({ ...track, clips: track.clips.map(clip => {
      if (clip.sourceType === 'caption') return clip;
      const mapped = assetId(clip.assetId)!;
      return { ...clip, assetId: mapped, sourceUrl: url(mapped), takes: clip.takes.map(take => {
        const nextId = assetId(take.assetId)!;
        return { ...take, assetId: nextId, sourceUrl: url(nextId), sourceGenerationId: null };
      }) };
    }) })),
  } : null;
  const canvas = { ...source.canvas, cards: source.canvas.cards.map(card => {
    if (card.type === 'timeline') {
      if (!timeline || card.timelineId !== timeline.id) throw Error('Canvas references an unavailable timeline');
      return { ...card, url: null, assetId: null, lastRenderAssetId: null, sourceGenerationId: null };
    }
    if (card.url && !card.assetId) throw Error(`Canvas media must have a project asset before export: ${card.name}`);
    const mapped = assetId(card.assetId);
    return { ...card, assetId: mapped, url: mapped ? url(mapped) : null,
      sourceGenerationId: null, error: null,
      status: card.status === 'pending' || card.status === 'processing' ? 'idle' as const : card.status };
  }) };
  return { timeline, canvas, coverAssetId: assetId(source.project.coverAssetId) };
}

export function inspectBundle(manifest: BundleManifest) {
  mapBundleDocuments(manifest, manifest.project.id, new Map(manifest.assets.map(asset => [asset.id, asset.id])), true);
  const hashes = new Map<string, number>();
  for (const asset of manifest.assets) {
    if (hashes.has(asset.sha256) && hashes.get(asset.sha256) !== asset.sizeBytes) throw Error('Conflicting media sizes for one hash');
    hashes.set(asset.sha256, asset.sizeBytes);
  }
  const storyboards = inspectStoryboardAttachment(manifest.storyboards ?? { boards: [], recipes: [] });
  return { ...storyboards, name: manifest.project.name, assetCount: manifest.assets.length, mediaBytes: [...hashes.values()].reduce((a, b) => a + b, 0),
    cardCount: manifest.canvas.cards.length, clipCount: manifest.timeline?.tracks.reduce((n, track) => n + track.clips.length, 0) ?? 0,
    duration: manifest.timeline?.duration ?? 0, revisions: manifest.revisions };
}

export function validateMediaRanges(manifest: BundleManifest) {
  if (manifest.storyboards) inspectStoryboardAttachment(manifest.storyboards, manifest.assets);
  const media = new Map(manifest.assets.map(asset => [asset.id, asset]));
  for (const track of manifest.timeline?.tracks ?? []) for (const clip of track.clips) {
    if (clip.sourceType === 'caption') continue;
    const asset = media.get(clip.assetId);
    if (!asset || asset.kind !== clip.sourceType) throw Error('Timeline media kind mismatch');
    if (asset.kind !== 'image' && (!asset.durationMs || clip.outPoint > asset.durationMs / 1000 + .05)) throw Error('Clip range exceeds its actual media');
    for (const take of clip.takes) {
      const source = media.get(take.assetId);
      if (!source || source.kind !== (take.sourceType ?? clip.sourceType) || (source.kind !== 'image' && (!source.durationMs || take.sourceDuration > source.durationMs / 1000 + .05))) throw Error('Take does not match its actual media');
    }
  }
  for (const card of manifest.canvas.cards) if (card.assetId && card.type !== 'timeline' && media.get(card.assetId)?.kind !== card.type) throw Error('Canvas media kind mismatch');
}
