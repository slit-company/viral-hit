import { storyboardPlan, type StoryboardPlan } from './contract';
import type { SceneAnalysis } from '../references/scene-contract';
import type { Transcript } from '../transcripts/contract';
import type { PrepareReference } from './reference-input';

/** Machine estimates seed an editable proposal; they do not establish scene semantics or accept results. */
export function buildReferencePlan(request: PrepareReference, source: { assetId: string; sha256: string }, analysis: SceneAnalysis, transcript?: Transcript): StoryboardPlan {
  if (request.lastScene < request.firstScene || request.lastScene >= analysis.scenes.length || request.lastScene - request.firstScene >= 16) throw Error('Choose one to sixteen consecutive detected scenes');
  if (transcript && (transcript.source.kind !== 'video' || transcript.source.assetId !== source.assetId || transcript.source.sha256 !== source.sha256)) throw Error('Speech and scene analysis must reference the same original video');
  const selected = analysis.scenes.slice(request.firstScene, request.lastScene + 1);
  if (transcript && !transcript.segments.some(item => item.end > selected[0].start && item.start < selected.at(-1)!.end)) throw Error('Selected transcript has no speech overlapping these scenes');
  const references: StoryboardPlan['references'] = [];
  const shots = selected.map((scene, index) => {
    const number = request.firstScene + index + 1, id = 'scene-' + number;
    references.push({ id, ...source, startTime: scene.start, endTime: scene.end, basis: 'inferred',
      observation: `Machine-detected visual interval ${scene.start.toFixed(3)}–${scene.end.toFixed(3)}s. Boundary score ${scene.score}; inspect the recording for subject, action, framing and meaning.`,
      evidence: { ...request.scenes, kind: 'scene-detection', engine: analysis.algorithm } });
    const shotReferences = [id];
    const speech = transcript?.segments.filter(item => item.end > scene.start && item.start < scene.end) ?? [];
    if (speech.length && transcript && request.transcript) {
      const speechId = 'speech-' + number;
      const observation = 'Machine-estimated speech overlapping this interval; entire segments are quoted, including words outside a cut. Review words and alignment.\n' + speech.map(item => `${item.start.toFixed(3)}–${item.end.toFixed(3)}s: ${item.text}`).join('\n');
      if (observation.length > 4000) throw Error('Speech context exceeds a reference note; choose shorter transcript ranges');
      references.push({ id: speechId, ...source, startTime: Math.max(scene.start, transcript.range.start), endTime: Math.min(scene.end, transcript.range.end), basis: 'inferred', observation,
        evidence: { ...request.transcript, kind: 'speech-transcript', engine: `${transcript.engine.id} · ${transcript.engine.model}`.slice(0, 200) } });
      shotReferences.push(speechId);
    }
    return { id: 'shot-' + number, title: 'Reference scene ' + number, duration: Math.round((scene.end - scene.start) * 1000) / 1000,
      direction: `Review source ${scene.start.toFixed(3)}–${scene.end.toFixed(3)}s and describe the intended shot before choosing a production recipe.`,
      references: shotReferences, preserve: [], change: [], avoid: [], caption: '' };
  });
  return storyboardPlan.parse({ schemaVersion: 1, title: request.title, scope: request.scope, intent: request.intent, references, shots, audio: [] });
}
