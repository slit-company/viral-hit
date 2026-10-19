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
      if (file.size > 128_000) throw new Error('API graph files must be 128 KB or smaller.');
      const value = await file.text(); if (current === epoch.current) editGraph(value);
    } catch (error) { if (current === epoch.current) setError(error instanceof Error ? error.message : 'Could not read graph'); }
  }
  async function inspect() {
    const current = ++epoch.current; setBusy(true); setError('');
    try {
      if (new TextEncoder().encode(text).byteLength > 128_000) throw new Error('API graph JSON must be 128 KB or smaller.');
      const graph = JSON.parse(text);
      const result = await apiJsonPost<Omit<GraphSnapshot, 'graph'>>('/api/app/recipes', { action: 'inspect_graph', graph });
      if (current !== epoch.current) return;
      setSnapshot({ ...result, graph }); setActiveNode(result.nodes[0].nodeId); setSearch(''); setVisibleInputs(40); setExposures({});
    } catch (error) { if (current === epoch.current) setError(error instanceof Error ? error.message : 'Could not inspect graph'); }
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
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not build recipe'); }
    finally { setBusy(false); }
  }
  const node = snapshot?.nodes.find(item => item.nodeId === activeNode);
  const inputs = node?.inputs.filter(item => item.input.toLowerCase().includes(search.toLowerCase())) ?? [];
  const ready = Boolean(snapshot && output.nodeId && output.index !== '' && Object.values(metadata).every(value => value.trim()));
  return <div className="space-y-4">
    <Action disabled={busy} onClick={onBack} className="inline-flex items-center gap-1.5 text-xs text-[var(--vh-text-2)]"><ArrowLeft size={14} />Back to recipe JSON</Action>
    <div><h3 className="text-sm font-semibold">Build from a ComfyUI graph</h3><p className="mt-1 text-xs leading-relaxed text-[var(--vh-text-2)]">Use an API-format graph: node IDs mapped to class_type and inputs. Canvas layout JSON cannot be converted here.</p></div>
    <details open={!snapshot} className="rounded-xl border border-[var(--vh-border)] p-3">
      <summary className="cursor-pointer text-xs font-medium">API graph source{snapshot ? ` · ${snapshot.nodes.length} nodes` : ''}</summary>
      <div className="mt-3 space-y-2">
        <input ref={upload} type="file" accept="application/json,.json" aria-label="Import ComfyUI graph file" className="hidden" onChange={event => { void loadFile(event.target.files?.[0]); event.target.value = ''; }} />
        <Action disabled={busy} onClick={() => upload.current?.click()} className="inline-flex items-center gap-1.5 text-xs"><FileJson size={14} />Choose API graph JSON</Action>
        <textarea aria-label="ComfyUI API graph JSON" value={text} disabled={busy} onChange={event => editGraph(event.target.value)} spellCheck={false} className="h-44 w-full rounded-lg border border-[var(--vh-border)] bg-[var(--vh-control)] p-3 font-mono text-xs leading-5" />
      </div>
    </details>
    {snapshot && <div ref={definitionPanel} className="space-y-5">
      <section className="space-y-3">
        <h4 className="text-sm font-semibold">1. Name and attribution</h4>
        <div className="grid gap-3 sm:grid-cols-2">
          {([['title', 'Recipe name'], ['id', 'Recipe ID'], ['author', 'Source author'], ['license', 'Source license'], ['version', 'Recipe version'], ['category', 'Recipe category']] as const).map(([key, label]) => <label key={key} className="space-y-1 text-xs"><span>{label}</span><input disabled={busy} value={metadata[key]} onChange={event => setMetadata({ ...metadata, [key]: event.target.value })} className={controlClass} maxLength={key === 'id' || key === 'category' ? 80 : 120} /></label>)}
        </div>
        <label className="block space-y-1 text-xs"><span>Recipe description</span><textarea disabled={busy} value={metadata.description} onChange={event => setMetadata({ ...metadata, description: event.target.value })} maxLength={2000} className="h-20 w-full rounded-lg border border-[var(--vh-border)] bg-[var(--vh-control)] p-3 text-xs" /></label>
        <p className="text-[11px] text-[var(--vh-text-2)]">Use the graph’s original attribution and license. IDs use lowercase letters, digits and hyphens, starting with a letter.</p>
      </section>
      <section className="space-y-3">
        <h4 className="text-sm font-semibold">2. Choose adjustable inputs <span className="font-normal text-[var(--vh-text-2)]">· {Object.keys(exposures).length}/64</span></h4>
        <label className="block space-y-1 text-xs"><span>Inspect node</span><select aria-label="Inspect node" disabled={busy} value={activeNode} onChange={event => { setActiveNode(event.target.value); setSearch(''); setVisibleInputs(40); }} className={controlClass}>{snapshot.nodes.map(node => <option key={node.nodeId} value={node.nodeId}>#{node.nodeId} · {node.title.slice(0, 100)} ({node.classType})</option>)}</select></label>
        <input aria-label="Filter node inputs" value={search} onChange={event => { setSearch(event.target.value); setVisibleInputs(40); }} placeholder="Find an input…" className={controlClass} />
        <p className="text-[11px] text-[var(--vh-text-2)]">Expose scalar values as controls. Unselected values and node connections stay in the graph. Defaults come from the source values.</p>
        {node && inputs.slice(0, visibleInputs).map(input => {
          const key = keyOf(node.nodeId, input.input), exposure = exposures[key], label = `#${node.nodeId} ${input.input}`;
          return <div key={key} className="space-y-2 rounded-xl border border-[var(--vh-border)] p-3">
            <label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={Boolean(exposure)} disabled={busy || !input.exposable || (!exposure && Object.keys(exposures).length >= 64)} aria-label={`Expose ${label}`} onChange={event => expose(node.nodeId, input.input, input.value, event.target.checked)} className="mt-0.5" /><span className="min-w-0 break-words font-medium">{input.input}</span></label>
            <p className="break-all text-[11px] text-[var(--vh-text-2)]">{input.exposable ? `Source: ${String(input.value).slice(0, 140)}${String(input.value).length > 140 ? '…' : ''}` : 'Connected or structured value · preserved'}</p>
            {exposure && <div className="space-y-2 border-t border-[var(--vh-border)] pt-2">
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="space-y-1 text-xs"><span>Control label</span><input aria-label={`Control label for ${label}`} value={exposure.label} disabled={busy} onChange={event => patch(key, { label: event.target.value })} maxLength={120} className={controlClass} /></label>
                <label className="space-y-1 text-xs"><span>Control ID</span><input aria-label={`Control ID for ${label}`} value={exposure.id} disabled={busy} onChange={event => patch(key, { id: event.target.value })} maxLength={80} className={controlClass} /></label>
              </div>
              {typeof exposure.value === 'string' && <label className="block space-y-1 text-xs"><span>Control type</span><select aria-label={`Control type for ${label}`} disabled={busy} value={exposure.mode} onChange={event => patch(key, { mode: event.target.value as Exposure['mode'] })} className={controlClass}><option value="string">Text</option><option value="enum">Choice list</option><option value="asset">Project image</option></select></label>}
              {exposure.mode === 'string' && <label className="flex items-center gap-2 text-xs"><input disabled={busy} type="checkbox" checked={exposure.multiline} onChange={event => patch(key, { multiline: event.target.checked })} />Multiline text</label>}
              {exposure.mode === 'enum' && <label className="block space-y-1 text-xs"><span>Choices, one per line</span><textarea aria-label={`Choices for ${label}`} disabled={busy} value={exposure.options} onChange={event => patch(key, { options: event.target.value })} className="h-20 w-full rounded-lg border border-[var(--vh-border)] bg-[var(--vh-control)] p-2 text-xs" /></label>}
              {exposure.mode === 'asset' && <p className="text-[11px] text-[var(--vh-text-2)]">Use this only for an image filename input. Runs will upload a selected project image and bind the server filename here. The original filename is not a project-image default.</p>}
              {exposure.mode === 'number' && <><div className="grid grid-cols-2 gap-2">{(['min', 'max'] as const).map(bound => <label key={bound} className="space-y-1 text-xs"><span>{bound === 'min' ? 'Minimum (optional)' : 'Maximum (optional)'}</span><input aria-label={`${bound} for ${label}`} disabled={busy} type="number" value={exposure[bound]} onChange={event => patch(key, { [bound]: event.target.value })} className={controlClass} /></label>)}</div><label className="flex items-center gap-2 text-xs"><input disabled={busy} type="checkbox" checked={exposure.integer} onChange={event => patch(key, { integer: event.target.checked })} />Whole numbers only</label></>}
            </div>}
          </div>;
        })}
        {inputs.length > visibleInputs && <Action onClick={() => setVisibleInputs(current => current + 40)} className="text-xs underline">Show more inputs ({inputs.length - visibleInputs} remaining)</Action>}
        {Object.keys(exposures).length > 0 && <p className="break-words text-xs text-[var(--vh-text-2)]">Selected controls: {Object.values(exposures).map(item => item.label).join(', ')}</p>}
      </section>
      <section className="space-y-3">
        <h4 className="text-sm font-semibold">3. Select the result to keep</h4>
        <label className="block space-y-1 text-xs"><span>Output node</span><select aria-label="Output node" disabled={busy} value={output.nodeId} onChange={event => setOutput({ ...output, nodeId: event.target.value })} className={controlClass}><option value="">Choose the output node</option>{snapshot.nodes.map(node => <option key={node.nodeId} value={node.nodeId}>#{node.nodeId} · {node.title.slice(0, 100)} ({node.classType})</option>)}</select></label>
        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-1 text-xs"><span>Output array</span><select aria-label="Output array" disabled={busy} value={output.field} onChange={event => setOutput({ ...output, field: event.target.value })} className={controlClass}>{['images', 'audio', 'gifs', 'videos'].map(field => <option key={field}>{field}</option>)}</select></label>
          <label className="space-y-1 text-xs"><span>Media kind</span><select aria-label="Media kind" disabled={busy} value={output.kind} onChange={event => setOutput({ ...output, kind: event.target.value })} className={controlClass}>{['image', 'video', 'audio'].map(kind => <option key={kind}>{kind}</option>)}</select></label>
        </div>
        <label className="block space-y-1 text-xs"><span>Output index (starts at 0)</span><input disabled={busy} type="number" min={0} max={255} step={1} value={output.index} onChange={event => setOutput({ ...output, index: event.target.value })} className={controlClass} /></label>
        <p className="text-[11px] leading-relaxed text-[var(--vh-text-2)]">Choose the actual node and history output array used by your graph. These are not inferred from node names. Building a recipe does not install nodes, download models or run the graph.</p>
      </section>
    </div>}
    {error && <p ref={errorPanel} role="alert" className="whitespace-pre-wrap break-words rounded-lg bg-red-500/10 p-3 text-xs text-red-800">{error}</p>}
    <div className="sticky -bottom-px z-10 border-t border-[var(--vh-border)] bg-[var(--vh-surface)] py-3">
      <Action disabled={busy || (snapshot ? !ready : !text.trim())} onClick={() => void (snapshot ? build() : inspect())} className="vh-primary w-full text-xs">{busy ? 'Working…' : snapshot ? 'Build recipe for review' : 'Inspect API graph'}</Action>
    </div>
  </div>;
}
