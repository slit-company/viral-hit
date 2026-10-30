import { m as uiMessages } from '@/paraglide/messages.js';
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, FileJson } from 'lucide-react';
import { Action } from '@/components/base/action';
import { apiJsonPost } from '@/lib/api-client';
import type { Recipe } from '@/core/harness/recipes';
import type { inspectComfyGraph } from '@/core/harness/import-comfy-recipe';
import type { RecipeInspection } from './recipe-library';

type GraphSnapshot = { graph: unknown; graphDigest: string; nodes: ReturnType<typeof inspectComfyGraph> };
type Exposure = { nodeId: string; input: string; value: string | number | boolean; id: string; label: string; mode: 'string' | 'number' | 'boolean' | 'enum' | 'asset'; min: string; max: string; integer: boolean; multiline: boolean; options: string };
const keyOf = (nodeId: string, input: string) => JSON.stringify([nodeId, input]);
const controlClass = 'h-10 w-full min-w-0 rounded-lg border border-[var(--vh-border)] bg-[var(--vh-control)] px-3 text-xs text-[var(--vh-text-1)]';
function parameter(exposure: Exposure): Recipe['parameters'][number] {
  const base = { id: exposure.id, label: exposure.label };
  switch (exposure.mode) {
    case 'asset': return { ...base, type: 'asset', kind: 'image' };
    case 'string': return { ...base, type: 'string', multiline: exposure.multiline, minLength: exposure.value === '' ? 0 : 1 };
    case 'enum': return { ...base, type: 'enum', options: exposure.options.split('\n').filter(value => value.length > 0) };
    case 'boolean': return { ...base, type: 'boolean' };
    case 'number': return { ...base, type: 'number', integer: exposure.integer,
      ...(exposure.min !== '' ? { min: Number(exposure.min) } : {}), ...(exposure.max !== '' ? { max: Number(exposure.max) } : {}) };
  }
}

export function ComfyRecipeBuilder({ onBack, onBuilt }: { onBack: () => void; onBuilt: (result: RecipeInspection) => void }) {
  const [text, setText] = useState('');
  const [snapshot, setSnapshot] = useState<GraphSnapshot>();
  const [activeNode, setActiveNode] = useState('');
  const [search, setSearch] = useState('');
  const [visibleInputs, setVisibleInputs] = useState(40);
  const [exposures, setExposures] = useState<Record<string, Exposure>>({});
  const [metadata, setMetadata] = useState({ id: '', title: '', version: '1.0.0', author: '', license: '', description: '', category: 'self-hosted' });
  const [output, setOutput] = useState({ nodeId: '', field: 'images', index: '0', kind: 'image' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const upload = useRef<HTMLInputElement>(null), definitionPanel = useRef<HTMLDivElement>(null);
  const epoch = useRef(0);
  const errorPanel = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (error) errorPanel.current?.scrollIntoView({ block: 'start' }); }, [error]);
  useEffect(() => { if (snapshot) definitionPanel.current?.scrollIntoView({ block: 'start' }); }, [snapshot]);
  function editGraph(value: string) { epoch.current++; setText(value); setSnapshot(undefined); setExposures({}); setOutput(current => ({ ...current, nodeId: '' })); setError(''); }
  async function loadFile(file?: File) {
    if (!file) return;
    const current = ++epoch.current; setError('');
    try {
      if (file.size > 128_000) throw new Error(uiMessages["ui.app.api_graph_files_must_be_128_kb_or_smaller"]());
      const value = await file.text(); if (current === epoch.current) editGraph(value);
    } catch (error) { if (current === epoch.current) setError(error instanceof Error ? error.message : uiMessages["ui.app.could_not_read_graph"]()); }
  }
  async function inspect() {
    const current = ++epoch.current; setBusy(true); setError('');
    try {
      if (new TextEncoder().encode(text).byteLength > 128_000) throw new Error(uiMessages["ui.app.api_graph_json_must_be_128_kb_or_smaller"]());
      const graph = JSON.parse(text);
      const result = await apiJsonPost<Omit<GraphSnapshot, 'graph'>>('/api/app/recipes', { action: 'inspect_graph', graph });
      if (current !== epoch.current) return;
      setSnapshot({ ...result, graph }); setActiveNode(result.nodes[0].nodeId); setSearch(''); setVisibleInputs(40); setExposures({});
    } catch (error) { if (current === epoch.current) setError(error instanceof Error ? error.message : uiMessages["ui.app.could_not_inspect_graph"]()); }
    finally { setBusy(false); }
  }
  function expose(nodeId: string, input: string, value: unknown, checked: boolean) {
    const key = keyOf(nodeId, input);
    if (!checked) { setExposures(current => { const next = { ...current }; delete next[key]; return next; }); return; }
    if (!['string', 'number', 'boolean'].includes(typeof value)) return;
    const scalar = value as string | number | boolean;
    setExposures(current => ({ ...current, [key]: { nodeId, input, value: scalar,
      id: `input-${nodeId}-${input}`.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 80), label: `${input} · #${nodeId}`.slice(0, 120),
      mode: typeof scalar as 'string' | 'number' | 'boolean', min: '', max: '', integer: typeof scalar === 'number' && Number.isInteger(scalar),
      multiline: typeof scalar === 'string' && (scalar.includes('\n') || scalar.length > 100), options: String(scalar) } }));
  }
  function patch(key: string, value: Partial<Exposure>) { setExposures(current => ({ ...current, [key]: { ...current[key], ...value } })); }
  async function build() {
    if (!snapshot) return;
    setBusy(true); setError('');
    try {
      const definition = { schemaVersion: 1, ...metadata, tags: ['comfyui', output.kind],
        output: { ...output, index: Number(output.index) },
        parameters: Object.values(exposures).map(exposure => ({ parameter: parameter(exposure), targets: [{ nodeId: exposure.nodeId, input: exposure.input }] })) };
      const result = await apiJsonPost<RecipeInspection>('/api/app/recipes', { action: 'convert_graph', graph: snapshot.graph, expectedGraphDigest: snapshot.graphDigest, definition });
      onBuilt(result);
    } catch (error) { setError(error instanceof Error ? error.message : uiMessages["ui.app.could_not_build_recipe"]()); }
    finally { setBusy(false); }
  }
  const node = snapshot?.nodes.find(item => item.nodeId === activeNode);
  const inputs = node?.inputs.filter(item => item.input.toLowerCase().includes(search.toLowerCase())) ?? [];
  const ready = Boolean(snapshot && output.nodeId && output.index !== '' && Object.values(metadata).every(value => value.trim()));
  return <div className="space-y-4">
    <Action disabled={busy} onClick={onBack} className="inline-flex items-center gap-1.5 text-xs text-[var(--vh-text-2)]"><ArrowLeft size={14} />{uiMessages["ui.app.back_to_recipe_json"]()}</Action>
    <div><h3 className="text-sm font-semibold">{uiMessages["ui.app.build_from_a_comfyui_graph"]()}</h3><p className="mt-1 text-xs leading-relaxed text-[var(--vh-text-2)]">{uiMessages["ui.app.use_an_api_format_graph_node_ids_mapped_to_class_type_and_inputs_canvas_lay"]()}</p></div>
    <details open={!snapshot} className="rounded-xl border border-[var(--vh-border)] p-3">
      <summary className="cursor-pointer text-xs font-medium">{uiMessages["ui.app.api_graph_source"]()}{snapshot ? uiMessages["ui.app.node_count"]({ count: snapshot.nodes.length }) : ''}</summary>
      <div className="mt-3 space-y-2">
        <input ref={upload} type="file" accept="application/json,.json" aria-label={uiMessages["ui.app.import_comfyui_graph_file"]()} className="hidden" onChange={event => { void loadFile(event.target.files?.[0]); event.target.value = ''; }} />
        <Action disabled={busy} onClick={() => upload.current?.click()} className="inline-flex items-center gap-1.5 text-xs"><FileJson size={14} />{uiMessages["ui.app.choose_api_graph_json"]()}</Action>
        <textarea aria-label={uiMessages["ui.app.comfyui_api_graph_json"]()} value={text} disabled={busy} onChange={event => editGraph(event.target.value)} spellCheck={false} className="h-44 w-full rounded-lg border border-[var(--vh-border)] bg-[var(--vh-control)] p-3 font-mono text-xs leading-5" />
      </div>
    </details>
    {snapshot && <div ref={definitionPanel} className="space-y-5">
      <section className="space-y-3">
        <h4 className="text-sm font-semibold">{uiMessages["ui.app.1_name_and_attribution"]()}</h4>
        <div className="grid gap-3 sm:grid-cols-2">
          {([['title', uiMessages["ui.app.recipe_name"]()], ['id', uiMessages["ui.app.recipe_id"]()], ['author', uiMessages["ui.app.source_author"]()], ['license', uiMessages["ui.app.source_license"]()], ['version', uiMessages["ui.app.recipe_version"]()], ['category', uiMessages["ui.app.recipe_category"]()]] as const).map(([key, label]) => <label key={key} className="space-y-1 text-xs"><span>{label}</span><input disabled={busy} value={metadata[key]} onChange={event => setMetadata({ ...metadata, [key]: event.target.value })} className={controlClass} maxLength={key === 'id' || key === 'category' ? 80 : 120} /></label>)}
        </div>
        <label className="block space-y-1 text-xs"><span>{uiMessages["ui.app.recipe_description"]()}</span><textarea disabled={busy} value={metadata.description} onChange={event => setMetadata({ ...metadata, description: event.target.value })} maxLength={2000} className="h-20 w-full rounded-lg border border-[var(--vh-border)] bg-[var(--vh-control)] p-3 text-xs" /></label>
        <p className="text-[11px] text-[var(--vh-text-2)]">{uiMessages["ui.app.use_the_graph_s_original_attribution_and_license_ids_use_lowercase_letters_"]()}</p>
      </section>
      <section className="space-y-3">
        <h4 className="text-sm font-semibold">{uiMessages["ui.app.2_choose_adjustable_inputs"]()} <span className="font-normal text-[var(--vh-text-2)]">· {Object.keys(exposures).length}/64</span></h4>
        <label className="block space-y-1 text-xs"><span>{uiMessages["ui.app.inspect_node"]()}</span><select aria-label={uiMessages["ui.app.inspect_node"]()} disabled={busy} value={activeNode} onChange={event => { setActiveNode(event.target.value); setSearch(''); setVisibleInputs(40); }} className={controlClass}>{snapshot.nodes.map(node => <option key={node.nodeId} value={node.nodeId}>#{node.nodeId} · {node.title.slice(0, 100)} ({node.classType})</option>)}</select></label>
        <input aria-label={uiMessages["ui.app.filter_node_inputs"]()} value={search} onChange={event => { setSearch(event.target.value); setVisibleInputs(40); }} placeholder={uiMessages["ui.app.find_an_input"]()} className={controlClass} />
        <p className="text-[11px] text-[var(--vh-text-2)]">{uiMessages["ui.app.expose_scalar_values_as_controls_unselected_values_and_node_connections_sta"]()}</p>
        {node && inputs.slice(0, visibleInputs).map(input => {
          const key = keyOf(node.nodeId, input.input), exposure = exposures[key], label = uiMessages["ui.app.node_input"]({ id: node.nodeId, input: input.input });
          return <div key={key} className="space-y-2 rounded-xl border border-[var(--vh-border)] p-3">
            <label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={Boolean(exposure)} disabled={busy || !input.exposable || (!exposure && Object.keys(exposures).length >= 64)} aria-label={uiMessages["ui.app.expose_input"]({ name: label })} onChange={event => expose(node.nodeId, input.input, input.value, event.target.checked)} className="mt-0.5" /><span className="min-w-0 break-words font-medium">{input.input}</span></label>
            <p className="break-all text-[11px] text-[var(--vh-text-2)]">{input.exposable ? uiMessages["ui.app.input_source"]({ value: String(input.value).slice(0, 140) + (String(input.value).length > 140 ? '…' : '') }) : uiMessages["ui.app.connected_or_structured_value_preserved"]()}</p>
            {exposure && <div className="space-y-2 border-t border-[var(--vh-border)] pt-2">
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="space-y-1 text-xs"><span>{uiMessages["ui.app.control_label"]()}</span><input aria-label={uiMessages["ui.app.input_label"]({ name: label })} value={exposure.label} disabled={busy} onChange={event => patch(key, { label: event.target.value })} maxLength={120} className={controlClass} /></label>
                <label className="space-y-1 text-xs"><span>{uiMessages["ui.app.control_id"]()}</span><input aria-label={uiMessages["ui.app.input_id"]({ name: label })} value={exposure.id} disabled={busy} onChange={event => patch(key, { id: event.target.value })} maxLength={80} className={controlClass} /></label>
              </div>
              {typeof exposure.value === 'string' && <label className="block space-y-1 text-xs"><span>{uiMessages["ui.app.control_type"]()}</span><select aria-label={uiMessages["ui.app.input_type"]({ name: label })} disabled={busy} value={exposure.mode} onChange={event => patch(key, { mode: event.target.value as Exposure['mode'] })} className={controlClass}><option value="string">{uiMessages["ui.app.text"]()}</option><option value="enum">{uiMessages["ui.app.choice_list"]()}</option><option value="asset">{uiMessages["ui.app.project_image"]()}</option></select></label>}
              {exposure.mode === 'string' && <label className="flex items-center gap-2 text-xs"><input disabled={busy} type="checkbox" checked={exposure.multiline} onChange={event => patch(key, { multiline: event.target.checked })} />{uiMessages["ui.app.multiline_text"]()}</label>}
              {exposure.mode === 'enum' && <label className="block space-y-1 text-xs"><span>{uiMessages["ui.app.choices_one_per_line"]()}</span><textarea aria-label={uiMessages["ui.app.input_choices"]({ name: label })} disabled={busy} value={exposure.options} onChange={event => patch(key, { options: event.target.value })} className="h-20 w-full rounded-lg border border-[var(--vh-border)] bg-[var(--vh-control)] p-2 text-xs" /></label>}
              {exposure.mode === 'asset' && <p className="text-[11px] text-[var(--vh-text-2)]">{uiMessages["ui.app.use_this_only_for_an_image_filename_input_runs_will_upload_a_selected_proje"]()}</p>}
              {exposure.mode === 'number' && <><div className="grid grid-cols-2 gap-2">{(['min', 'max'] as const).map(bound => <label key={bound} className="space-y-1 text-xs"><span>{bound === 'min' ? uiMessages["ui.app.minimum_optional"]() : uiMessages["ui.app.maximum_optional"]()}</span><input aria-label={bound === 'min' ? uiMessages["ui.app.input_minimum"]({ name: label }) : uiMessages["ui.app.input_maximum"]({ name: label })} disabled={busy} type="number" value={exposure[bound]} onChange={event => patch(key, { [bound]: event.target.value })} className={controlClass} /></label>)}</div><label className="flex items-center gap-2 text-xs"><input disabled={busy} type="checkbox" checked={exposure.integer} onChange={event => patch(key, { integer: event.target.checked })} />{uiMessages["ui.app.whole_numbers_only"]()}</label></>}
            </div>}
          </div>;
        })}
        {inputs.length > visibleInputs && <Action onClick={() => setVisibleInputs(current => current + 40)} className="text-xs underline">{uiMessages["ui.app.show_more_inputs"]()}{inputs.length - visibleInputs} {uiMessages["ui.app.remaining"]()}</Action>}
        {Object.keys(exposures).length > 0 && <p className="break-words text-xs text-[var(--vh-text-2)]">{uiMessages["ui.app.selected_controls"]()} {Object.values(exposures).map(item => item.label).join(', ')}</p>}
      </section>
      <section className="space-y-3">
        <h4 className="text-sm font-semibold">{uiMessages["ui.app.3_select_the_result_to_keep"]()}</h4>
        <label className="block space-y-1 text-xs"><span>{uiMessages["ui.app.output_node"]()}</span><select aria-label={uiMessages["ui.app.output_node"]()} disabled={busy} value={output.nodeId} onChange={event => setOutput({ ...output, nodeId: event.target.value })} className={controlClass}><option value="">{uiMessages["ui.app.choose_the_output_node"]()}</option>{snapshot.nodes.map(node => <option key={node.nodeId} value={node.nodeId}>#{node.nodeId} · {node.title.slice(0, 100)} ({node.classType})</option>)}</select></label>
        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-1 text-xs"><span>{uiMessages["ui.app.output_array"]()}</span><select aria-label={uiMessages["ui.app.output_array"]()} disabled={busy} value={output.field} onChange={event => setOutput({ ...output, field: event.target.value })} className={controlClass}>{['images', 'audio', 'gifs', 'videos'].map(field => <option key={field}>{field}</option>)}</select></label>
          <label className="space-y-1 text-xs"><span>{uiMessages["ui.app.media_kind"]()}</span><select aria-label={uiMessages["ui.app.media_kind"]()} disabled={busy} value={output.kind} onChange={event => setOutput({ ...output, kind: event.target.value })} className={controlClass}>{['image', 'video', 'audio'].map(kind => <option key={kind}>{kind}</option>)}</select></label>
        </div>
        <label className="block space-y-1 text-xs"><span>{uiMessages["ui.app.output_index_starts_at_0"]()}</span><input disabled={busy} type="number" min={0} max={255} step={1} value={output.index} onChange={event => setOutput({ ...output, index: event.target.value })} className={controlClass} /></label>
        <p className="text-[11px] leading-relaxed text-[var(--vh-text-2)]">{uiMessages["ui.app.choose_the_actual_node_and_history_output_array_used_by_your_graph_these_ar"]()}</p>
      </section>
    </div>}
    {error && <p ref={errorPanel} role="alert" className="whitespace-pre-wrap break-words rounded-lg bg-red-500/10 p-3 text-xs text-red-800">{error}</p>}
    <div className="sticky -bottom-px z-10 border-t border-[var(--vh-border)] bg-[var(--vh-surface)] py-3">
      <Action disabled={busy || (snapshot ? !ready : !text.trim())} onClick={() => void (snapshot ? build() : inspect())} className="vh-primary w-full text-xs">{busy ? uiMessages["ui.common.working"]() : snapshot ? uiMessages["ui.app.build_recipe_for_review"]() : uiMessages["ui.app.inspect_api_graph"]()}</Action>
    </div>
  </div>;
}
