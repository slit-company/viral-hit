import { persistExternalCommandWithConflictRetry } from '../commands/conflict-retry';
import { createCommandId, type ViralHitCommandOrigin } from '../commands/contracts';
import type { EditorOperation } from '../commands/editor-commands';
import { loadProjectTimeline } from '../editor/timeline-state';
import { assertRuntimeConfigured } from '../harness/capabilities';
import { pinRuntimePlan } from '../harness/runtime-plan';
import { openHarness } from '../harness/store';
import type { Json, NodeSpec } from '../harness/durable';
import { getGenerationModelDescriptor } from '../generation-providers/model-catalog';
import { estimatePlanCost } from '../costs/generation-cost.server';
import { readAssetSpeechWords } from '../effects/speech-words.server';
import { getActiveProject } from '../projects/projects';
import { getProjectAssetById } from '../workspace-lib/assets/user-assets';
import { DIALOGUE_REQUEST_PREFIX, MAX_DIALOGUE_LINES, dialogueRequest, dialogueSpeakers, parseDialogueScript, type DialogueView } from './contract';

type Job = { node_id: string; state: string; error: string | null; input_json: string; output_json: string | null };
const round = (value: number) => Math.round(value * 1000) / 1000;

/** The option that names the voice: voice_id or voice, as the model's catalog declares it. */
export function voiceOption(modelId: string) {
  const model = getGenerationModelDescriptor(modelId);
  if (!model || model.kind !== 'audio' || !model.studioTasks?.includes('text-to-speech')) throw Error('Choose a text-to-speech model');
  const control = model.controls?.find(item => /^voice(_id)?$/.test(item.key) && (item.type === 'string' || item.type === 'select'));
  if (!control) throw Error(model.name + ' does not let you choose a voice');
  return control.key;
}

/** One generation per line, each with its speaker's voice; the run is durable and keyed by the request. */
async function produce(projectId: string, request: Extract<ReturnType<typeof dialogueRequest.parse>, { action: 'produce' }>) {
  const lines = parseDialogueScript(request.script);
  if (!lines.length || lines.length > MAX_DIALOGUE_LINES) throw Error('Write 1 to ' + MAX_DIALOGUE_LINES + ' lines as "Name: words"');
  const missing = dialogueSpeakers(lines).filter(speaker => !request.cast[speaker]);
  if (missing.length) throw Error('Choose a voice for ' + missing.join(', '));
  const key = voiceOption(request.modelId);
  const nodes: NodeSpec[] = lines.map((line, index) => ({
    id: 'line-' + String(index + 1).padStart(2, '0'), operation: 'generation.model', version: '1', cache: true,
    input: { schemaVersion: 1, mode: 'audio', modelId: request.modelId, prompt: line.text, references: [], outputIndex: 0,
      parameters: { provider_options: { [key]: request.cast[line.speaker] } } } as unknown as Json,
  }));
  const plan = { projectId, nodes };
  assertRuntimeConfigured(plan.nodes);
  const pinned = await pinRuntimePlan(plan);
  const h = openHarness();
  try {
    h.db.exec('CREATE TABLE IF NOT EXISTS vh_dialogues (request_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, lines_json TEXT NOT NULL, created_at INTEGER NOT NULL)');
    const runId = h.enqueue(pinned, DIALOGUE_REQUEST_PREFIX + request.requestId);
    h.db.prepare('INSERT OR IGNORE INTO vh_dialogues VALUES (?, ?, ?, ?)').run(request.requestId, projectId, JSON.stringify(lines), Date.now());
    return { runId, lines: lines.length, cost: estimatePlanCost(nodes) };
  } finally { h.close(); }
}

/** Dialogues of a project, newest first, with each line's state and finished audio. */
export async function listDialogues(projectId: string): Promise<DialogueView[]> {
  const h = openHarness();
  try {
    h.db.exec('CREATE TABLE IF NOT EXISTS vh_dialogues (request_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, lines_json TEXT NOT NULL, created_at INTEGER NOT NULL)');
    const runs = (h.runs(projectId) as Array<{ id: string; request_key: string; created_at: number }>).filter(run => run.request_key.startsWith(DIALOGUE_REQUEST_PREFIX)).slice(0, 20);
    const views: DialogueView[] = [];
    for (const run of runs) {
      const requestId = run.request_key.slice(DIALOGUE_REQUEST_PREFIX.length);
      const record = h.db.prepare('SELECT lines_json FROM vh_dialogues WHERE request_id=? AND project_id=?').get(requestId, projectId) as { lines_json: string } | undefined;
      const script = record ? JSON.parse(record.lines_json) as { speaker: string; text: string }[] : [];
      const jobs = (h.jobs(run.id) as unknown as Job[]).filter(job => job.node_id.startsWith('line-')).sort((a, b) => a.node_id.localeCompare(b.node_id));
      const lines = await Promise.all(jobs.map(async (job, index) => {
        const input = JSON.parse(job.input_json) as { modelId: string; prompt: string; parameters: { provider_options: Record<string, string> } };
        const output = job.state === 'succeeded' && job.output_json ? JSON.parse(job.output_json) as { assetId?: string } : null;
        const asset = output?.assetId ? await getProjectAssetById({ projectId, assetId: output.assetId }) : null;
        return { index, speaker: script[index]?.speaker ?? 'Narrator', text: input.prompt, voice: Object.values(input.parameters.provider_options)[0] ?? '', state: job.state, error: job.error,
          ...(asset ? { assetId: asset.id, url: asset.publicUrl, duration: (asset.durationMs ?? 0) / 1000 } : {}) };
      }));
      const modelId = jobs[0] ? (JSON.parse(jobs[0].input_json) as { modelId: string }).modelId : '';
      views.push({ requestId, runId: run.id, modelId, createdAt: run.created_at, lines });
    }
    return views;
  } finally { h.close(); }
}

/**
 * Finished lines go on the timeline one after another as voice clips, after the last voice already there, so
 * music ducks under them. Measured word timing becomes captions when the voice service returned it.
 */
async function place(projectId: string, request: Extract<ReturnType<typeof dialogueRequest.parse>, { action: 'place' }>, origin: ViralHitCommandOrigin) {
  const dialogue = (await listDialogues(projectId)).find(item => item.requestId === request.requestId);
  if (!dialogue) throw Error('Dialogue not found');
  if (dialogue.lines.some(line => !line.assetId || !line.duration)) throw Error('Wait until every line has finished');
  const timeline = await loadProjectTimeline(projectId);
  const voices = timeline?.document.tracks.flatMap(track => track.clips).filter(clip => clip.audioRole === 'voice') ?? [];
  let cursor = round(Math.max(0, ...voices.map(clip => clip.startTime + clip.duration + request.gap)));
  const operations: EditorOperation[] = [], words: { text: string; start: number; end: number }[] = [];
  for (const line of dialogue.lines) {
    operations.push({ type: 'add_clip', clipId: 'dialogue-' + request.requestId.slice(0, 8) + '-' + (line.index + 1), assetId: line.assetId!, sourceUrl: '', name: line.speaker + ': ' + line.text.slice(0, 40),
      sourceType: 'audio', sourceDuration: line.duration!, startTime: cursor, audioRole: 'voice' });
    if (request.captions) for (const word of await readAssetSpeechWords({ projectId, assetId: line.assetId! }) ?? []) words.push({ text: word.text, start: round(cursor + word.start), end: round(cursor + word.end) });
    cursor = round(cursor + line.duration! + request.gap);
  }
  if (words.length) operations.push({ type: 'captions_from_words', words });
  const commandId = createCommandId();
  const result = await persistExternalCommandWithConflictRetry({ input: { projectId, origin, commandId, idempotencyKey: commandId, expectedRevision: timeline?.version ?? null, command: { type: 'editor.apply', operations } } });
  if (!result.ok) throw Error(result.message);
  return { revision: result.revision, clips: dialogue.lines.length, captions: words.length > 0, end: cursor };
}

/** The single operation behind the HTTP route, the editor dialog and the MCP tool. */
export async function changeDialogues(projectId: string, raw: unknown, origin: ViralHitCommandOrigin) {
  const request = dialogueRequest.parse(raw);
  if (!await getActiveProject({ projectId })) throw Error('Project not found');
  if (request.action === 'list') return { dialogues: await listDialogues(projectId) };
  if (request.action === 'produce') return produce(projectId, request);
  return place(projectId, request, origin);
}
