import { RejectedSubmission, type Adapter } from '../harness/durable';
import { projectMediaPin } from '../harness/project-media-input-schema';
import { getActiveProject } from '../projects/projects';
import { referenceReceipt, sampleReferenceInput, youtubeReferenceInput } from './recipe-contract';
import { youtubeEngineIdentity } from './engine-identity.server';
import { importYouTubeVideo } from './intake.server';
import { sampleProjectReference } from './project-video.server';
import { retainedReference } from './reference-assets.server';

export function createReferenceAdapter(operation: 'reference.youtube' | 'reference.sample'): Adapter {
  return {
    recovery: 'replay',
    execution: { timeoutMs: 240000, abortOnCancel: true },
    async submit(raw, context) {
      if (!context.projectId) throw new RejectedSubmission('Reference intake requires a project');
      if (operation === 'reference.youtube') {
        const input = youtubeReferenceInput.parse(raw);
        if (!input.engine || input.engine !== youtubeEngineIdentity()) throw new Error('Original YouTube engine changed or is unavailable; restore it to recover this request');
        const result = await importYouTubeVideo(context.projectId, input.videoId, context.signal, input.height);
        return { id: JSON.stringify(result) };
      }
      const input = sampleReferenceInput.parse(raw), parsed = projectMediaPin.safeParse(input.pin);
      if (!parsed.success || parsed.data.assetId !== input.assetId || parsed.data.projectId !== context.projectId || parsed.data.kind !== 'video') throw new RejectedSubmission('Reference requires a pinned project video');
      return { id: JSON.stringify(await sampleProjectReference(context.projectId, parsed.data, context.signal)) };
    },
    async poll(id, _raw, signal, context) {
      if (!context?.projectId || !await getActiveProject({ projectId: context.projectId })) throw new Error('Reference project is unavailable');
      const receipt = referenceReceipt.parse(JSON.parse(id));
      for (const asset of [receipt.original, ...receipt.samples]) {
        const retained = await retainedReference(context.projectId, asset.assetId, signal);
        if (!retained || retained.sha256 !== asset.sha256 || retained.type !== asset.kind) throw new Error('Reference receipt no longer matches project assets');
      }
      return { state: 'succeeded', output: { ...receipt.original, projectId: context.projectId, mediaMaterialized: true,
        reference: { source: receipt.source, sourceKey: receipt.sourceKey, analysisScope: receipt.analysisScope, samples: receipt.samples } } };
    },
    // Local assets may have completed before cancellation. Poll reports the actual retained outcome.
    async cancel() {},
  };
}
