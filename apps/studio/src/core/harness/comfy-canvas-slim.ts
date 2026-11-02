/**
 * Drops canvas layout (positions, sizes, colours, notes) from a ComfyUI canvas workflow, keeping only
 * what conversion reads. Saved canvases are mostly layout, so this keeps uploads small.
 */
type Raw = Record<string, unknown>;
const NOTE_TYPES = new Set(['Note', 'MarkdownNote']);
const slimNode = (node: Raw) => ({
  id: node.id, type: node.type, ...(node.mode ? { mode: node.mode } : {}), ...(node.title ? { title: node.title } : {}),
  inputs: Array.isArray(node.inputs) ? node.inputs.map((input: Raw) => ({ name: input.name, type: input.type, link: input.link ?? null })) : [],
  ...(node.widgets_values !== undefined && !NOTE_TYPES.has(String(node.type)) ? { widgets_values: node.widgets_values } : {}),
});
const slimPort = (port: Raw) => ({ name: port.name, type: port.type, linkIds: Array.isArray(port.linkIds) ? port.linkIds : [] });

export function slimCanvasWorkflow(raw: Raw) {
  const subgraphs = ((raw.definitions as Raw | undefined)?.subgraphs as Raw[] | undefined) ?? [];
  return {
    nodes: (raw.nodes as Raw[]).map(slimNode),
    links: raw.links,
    definitions: { subgraphs: subgraphs.map((graph) => ({ id: graph.id, name: graph.name, nodes: (graph.nodes as Raw[] ?? []).map(slimNode), links: graph.links ?? [],
      inputs: (graph.inputs as Raw[] ?? []).map(slimPort), outputs: (graph.outputs as Raw[] ?? []).map(slimPort) })) },
  };
}
