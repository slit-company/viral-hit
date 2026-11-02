import { sceneInput, SCENE_MAX_BYTES } from './scene-contract';
import { grammarInput, GRAMMAR_MAX_BYTES } from '../remix/grammar-contract';
import { grammarEngineIdentity } from '../remix/grammar-analysis.server';
import { sceneEngineIdentity } from './scene-detection.server';
import type { Plan } from '../harness/durable';
import { isAssetOperation, assetOperationKind } from '../harness/asset-operations';
import { sampleReferenceInput, youtubeReferenceInput } from './recipe-contract';
import { youtubeEngineIdentity } from './engine-identity.server';
import { inspectProjectReference } from './project-video.server';

export async function pinReferencePlan(plan: Plan, signal = AbortSignal.timeout(30000)): Promise<Plan> {
  const result = structuredClone(plan);
  for (const node of result.nodes) {
    if (node.operation === 'reference.youtube') {
      if (node.bindings?.length) throw new Error('YouTube reference requires an explicit video selection');
      const input = youtubeReferenceInput.parse(node.input), engine = youtubeEngineIdentity();
      if (!engine || (input.engine && input.engine !== engine)) throw new Error('Install the matching YoutubeExplode engine before queueing');
      node.input = { ...input, engine };
    } else if (node.operation === 'reference.sample' || node.operation === 'reference.scenes' || node.operation === 'reference.grammar') {
      const input = node.operation === 'reference.scenes' ? sceneInput.parse(node.input) : node.operation === 'reference.grammar' ? grammarInput.parse(node.input) : sampleReferenceInput.parse(node.input);
      const scene: Record<string, string> = node.operation === 'reference.scenes' ? { engine: await sceneEngineIdentity(signal) }
        : node.operation === 'reference.grammar' ? { engine: await grammarEngineIdentity(grammarInput.parse(node.input).text, signal) } : {};
      if ('engine' in input && input.engine && input.engine !== scene.engine) throw Error('Scene detector engine changed');
      if (input.pin) throw new Error('Reference input was already pinned');
      if (node.bindings?.length) {
        const [binding] = node.bindings, source = result.nodes.find(other => other.id === binding.node);
        if (node.bindings.length !== 1 || binding.target !== '/assetId' || binding.pointer !== '/assetId'
          || !source || !isAssetOperation(source.operation) || assetOperationKind(source.operation, source.input) !== 'video'
          || !node.dependsOn?.includes(source.id)) throw new Error('Reference input must bind a video asset-producing dependency');
        node.input = { ...input, ...scene, pin: { projectId: null, assetId: null, kind: null, sha256: null, sizeBytes: null } };
        for (const field of ['projectId', 'assetId', 'kind', 'sha256', 'sizeBytes']) {
          node.bindings.push({ target: `/pin/${field}`, node: source.id, pointer: `/${field}` });
        }
      } else {
        const { pin } = await inspectProjectReference(plan.projectId, input.assetId, signal);
        if (node.operation === 'reference.scenes' && pin.sizeBytes > SCENE_MAX_BYTES) throw Error('Scene analysis supports up to 64 MiB');
        if (node.operation === 'reference.grammar' && pin.sizeBytes > GRAMMAR_MAX_BYTES) throw Error('Edit analysis supports up to 64 MiB');
        node.input = { ...input, ...scene, pin };
      }
    }
  }
  return result;
}
