import {
  Handle,
  NodeResizer,
  Position,
  type NodeProps,
} from '@xyflow/react';

import type { CreativeCanvasFlowNode } from '../react-flow/creative-canvas-react-flow-types';

export function WorkflowGroupNode({
  data,
  selected,
}: NodeProps<CreativeCanvasFlowNode>) {
  const { w, h } = data.props;

  return (
    <>
      <NodeResizer
        isVisible={selected}
        minWidth={48}
        minHeight={48}
        lineClassName="!border-[var(--vh-graph)]"
        handleClassName="!size-2.5 !border-[var(--vh-graph)] !bg-[var(--vh-surface)]"
      />
      <Handle
        type="target"
        position={Position.Left}
        className="!pointer-events-none !h-px !w-px !border-0 !bg-transparent !opacity-0"
      />
      <div
        aria-hidden="true"
        style={{
          width: w,
          height: h,
          border: selected
            ? '1.5px dashed rgba(127,176,242,0.78)'
            : '1px solid transparent',
          borderRadius: 12,
          background: 'transparent',
          boxSizing: 'border-box',
        }}
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!pointer-events-none !h-px !w-px !border-0 !bg-transparent !opacity-0"
      />
    </>
  );
}
