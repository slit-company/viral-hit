import type { Json } from './durable';

/** Node definitions as ComfyUI serves them from /object_info, reduced to what conversion reads. */
export type ComfyInputSpec = [unknown, Record<string, unknown>?];
export type ComfyNodeDefinition = {
  input?: { required?: Record<string, ComfyInputSpec>; optional?: Record<string, ComfyInputSpec> };
  input_order?: { required?: string[]; optional?: string[] };
  output_node?: boolean;
};
export type ComfyDefinitions = Record<string, ComfyNodeDefinition>;
export type ComfyApiGraph = Record<string, { class_type: string; inputs: Record<string, Json>; _meta?: { title: string } }>;

type CanvasInput = { name: string; type?: string; link?: number | null };
type CanvasNode = { id: number; type: string; mode?: number; title?: string; inputs?: CanvasInput[]; widgets_values?: unknown[] | Record<string, unknown> };
type Link = { id: number; origin_id: number; origin_slot: number; target_id: number; target_slot: number; type?: string };
type RawLink = Link | [number, number, number, number, number, string?];
type Port = { name: string; type?: string; linkIds?: number[] };
type Subgraph = { id: string; nodes: CanvasNode[]; links: RawLink[]; inputs: Port[]; outputs: Port[] };
export type CanvasWorkflow = { nodes: CanvasNode[]; links: RawLink[]; definitions?: { subgraphs?: Subgraph[] } };

const SUBGRAPH_INPUT = -10, SUBGRAPH_OUTPUT = -20, MUTED = 2, BYPASSED = 4;
/** Canvas-only nodes: they route, note or hold values in the editor and never run. */
const CANVAS_ONLY = new Set(['Reroute', 'Note', 'MarkdownNote', 'PrimitiveNode']);
const WIDGET_TYPES = new Set(['INT', 'FLOAT', 'STRING', 'BOOLEAN', 'COMBO']);

export class CanvasConversionError extends Error {
  constructor(message: string, readonly missingNodes: string[] = []) { super(message); this.name = 'CanvasConversionError'; }
}

/** The canvas layout ComfyUI saves by default, as opposed to the API format it runs. */
export const isCanvasWorkflow = (raw: unknown): raw is CanvasWorkflow =>
  Boolean(raw && typeof raw === 'object' && Array.isArray((raw as { nodes?: unknown }).nodes) && Array.isArray((raw as { links?: unknown }).links));

const linkOf = (raw: RawLink): Link => Array.isArray(raw)
  ? { id: raw[0], origin_id: raw[1], origin_slot: raw[2], target_id: raw[3], target_slot: raw[4], type: raw[5] }
  : raw;
const kind = (spec: ComfyInputSpec) => (Array.isArray(spec[0]) ? 'COMBO' : String(spec[0]));
const flags = (spec: ComfyInputSpec) => spec[1] ?? {};
const ordered = (group: Record<string, ComfyInputSpec> | undefined, order: string[] | undefined) =>
  (order ?? Object.keys(group ?? {})).filter((name) => group?.[name]).map((name) => [name, group![name]] as const);
const comboChoices = (spec: ComfyInputSpec) => (Array.isArray(spec[0]) ? spec[0] : Array.isArray(flags(spec).options) ? flags(spec).options as unknown[] : null);

type Scope = { prefix: string; nodes: Map<number, CanvasNode>; links: Map<number, Link>; parent?: { scope: Scope; node: CanvasNode; graph: Subgraph } };
type Source = { ref: [string, number] } | { value: Json } | null;

/**
 * Converts a canvas workflow (with subgraphs, reroutes, muted and bypassed nodes) into the API format a
 * ComfyUI server runs, using that server's node definitions to name widget values the way its own
 * editor does. Nodes that cannot reach an output are left out.
 */
export function canvasToApi(canvas: CanvasWorkflow, definitions: ComfyDefinitions) {
  const subgraphs = new Map((canvas.definitions?.subgraphs ?? []).map((graph) => [graph.id, graph]));
  const scope = (nodes: CanvasNode[], links: RawLink[], prefix: string, parent?: Scope['parent']): Scope =>
    ({ prefix, nodes: new Map(nodes.map((node) => [node.id, node])), links: new Map(links.map((raw) => { const link = linkOf(raw); return [link.id, link]; })), parent });
  const inner = (outer: Scope, node: CanvasNode, depth: number): Scope => {
    if (depth > 16) throw new CanvasConversionError('Subgraphs are nested more than 16 levels deep.');
    const graph = subgraphs.get(node.type)!;
    return scope(graph.nodes, graph.links, outer.prefix + node.id + ':', { scope: outer, node, graph });
  };
  const widgetValue = (node: CanvasNode, index: number) => (Array.isArray(node.widgets_values) ? node.widgets_values[index] : undefined) as Json | undefined;

  function fromLink(at: Scope, linkId: number | null | undefined, depth: number): Source {
    const link = linkId == null ? undefined : at.links.get(linkId);
    return link ? fromOutput(at, link.origin_id, link.origin_slot, link.type, depth) : null;
  }
  function fromOutput(at: Scope, nodeId: number, slot: number, type: string | undefined, depth: number): Source {
    if (depth > 512) throw new CanvasConversionError('A link loops back on itself.');
    if (nodeId === SUBGRAPH_INPUT) {
      const parent = at.parent, port = parent?.graph.inputs[slot];
      if (!parent || !port) return null;
      const outside = parent.node.inputs?.find((input) => input.name === port.name);
      if (outside?.link != null) return fromLink(parent.scope, outside.link, depth + 1);
      const widgets = parent.graph.inputs.filter((input) => WIDGET_TYPES.has(String(input.type)));
      const value = widgets.includes(port) ? widgetValue(parent.node, widgets.indexOf(port)) : undefined;
      return value === undefined ? null : { value };
    }
    const node = at.nodes.get(nodeId);
    if (!node || node.mode === MUTED) return null;
    if (node.type === 'Reroute') return fromLink(at, node.inputs?.[0]?.link, depth + 1);
    if (node.type === 'PrimitiveNode') { const value = widgetValue(node, 0); return value === undefined ? null : { value }; }
    if (node.mode === BYPASSED) {
      const inputs = node.inputs ?? [];
      const through = (inputs[slot]?.type === type && inputs[slot]?.link != null ? inputs[slot] : undefined) ?? inputs.find((input) => input.type === type && input.link != null);
      return through ? fromLink(at, through.link, depth + 1) : null;
    }
    if (subgraphs.has(node.type)) {
      const nested = inner(at, node, at.prefix.split(':').length), linkId = nested.parent!.graph.outputs[slot]?.linkIds?.[0];
      const link = linkId == null ? undefined : nested.links.get(linkId);
      return link ? fromOutput(nested, link.origin_id, link.origin_slot, type, depth + 1) : null;
    }
    return { ref: [at.prefix + node.id, slot] };
  }

  const graph: ComfyApiGraph = {}, warnings: string[] = [], missing = new Set<string>();
  function convert(at: Scope, node: CanvasNode) {
    const definition = definitions[node.type];
    if (!definition) { missing.add(node.type); return; }
    const inputs: Record<string, Json> = {}, linked = new Map((node.inputs ?? []).filter((input) => input.link != null).map((input) => [input.name, input]));
    const named = node.widgets_values && !Array.isArray(node.widgets_values) ? node.widgets_values : null;
    let cursor = 0;
    const take = (id: string) => (named ? named[id] as Json | undefined : widgetValue(node, cursor++));
    /** Links win over widget values; returns the literal the input received, if any. */
    const connect = (id: string, fallback?: Json) => {
      const input = linked.get(id);
      const source = input ? fromLink(at, input.link, 0) : null;
      if (source && 'ref' in source) { inputs[id] = source.ref as unknown as Json; return undefined; }
      const value = source ? source.value : input ? undefined : fallback;
      if (value !== undefined) inputs[id] = value;
      return value;
    };
    const assign = (prefix: string, specs: ReadonlyArray<readonly [string, ComfyInputSpec]>) => {
      for (const [name, spec] of specs) {
        const id = prefix ? prefix + '.' + name : name, type = kind(spec), options = flags(spec);
        if (type === 'COMFY_AUTOGROW_V3') { for (const key of linked.keys()) if (key.startsWith(id + '.')) connect(key); continue; }
        if (type === 'COMFY_DYNAMICCOMBO_V3') {
          const choice = take(id);
          connect(id, choice);
          const option = (options.options as Array<{ key: string; inputs?: ComfyNodeDefinition['input'] }> | undefined)?.find((item) => item.key === choice);
          if (option) assign(id, [...ordered(option.inputs?.required, undefined), ...ordered(option.inputs?.optional, undefined)]);
          continue;
        }
        if (!WIDGET_TYPES.has(type) || options.forceInput) { connect(id); continue; }
        const value = take(id);
        if (!named && options.control_after_generate) cursor++;
        if (!named && (options.image_upload || options.video_upload || options.audio_upload)) cursor++;
        const used = connect(id, value === undefined ? (options.default as Json | undefined) : value), choices = comboChoices(spec);
        if (choices?.length && used !== undefined && !choices.includes(used)) warnings.push(`${node.type} ${at.prefix + node.id}: "${String(used)}" is not available on this server for ${id}`);
      }
    };
    assign('', [...ordered(definition.input?.required, definition.input_order?.required), ...ordered(definition.input?.optional, definition.input_order?.optional)]);
    graph[at.prefix + node.id] = { class_type: node.type, inputs, _meta: { title: node.title ?? node.type } };
  }
  function walk(at: Scope) {
    for (const node of at.nodes.values()) {
      if (node.mode === MUTED || node.mode === BYPASSED || CANVAS_ONLY.has(node.type)) continue;
      if (subgraphs.has(node.type)) walk(inner(at, node, at.prefix.split(':').length));
      else convert(at, node);
    }
  }
  walk(scope(canvas.nodes, canvas.links, ''));
  if (missing.size) throw new CanvasConversionError(`This server does not have these nodes: ${[...missing].sort().join(', ')}. Install them or choose a server that has them.`, [...missing].sort());

  // Keep only what an output node needs, as ComfyUI itself would execute.
  const keep = new Set<string>(), queue = Object.keys(graph).filter((id) => definitions[graph[id].class_type]?.output_node);
  if (!queue.length) throw new CanvasConversionError('The workflow has no output node (for example SaveImage or SaveVideo).');
  while (queue.length) {
    const id = queue.pop()!;
    if (keep.has(id) || !graph[id]) continue;
    keep.add(id);
    for (const value of Object.values(graph[id].inputs)) if (Array.isArray(value) && typeof value[0] === 'string' && typeof value[1] === 'number') queue.push(value[0]);
  }
  const pruned: ComfyApiGraph = Object.fromEntries(Object.entries(graph).filter(([id]) => keep.has(id)));
  return { graph: pruned, outputs: Object.keys(pruned).filter((id) => definitions[pruned[id].class_type]?.output_node), warnings };
}
