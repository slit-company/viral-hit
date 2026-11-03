import { useRef } from 'react';
import { m } from '@/paraglide/messages.js';
import { layerBox, type ImageLayerStack } from '@/core/image-layers/contract';
import { cn } from '@/lib/utils';

export const layerUrl = (projectId: string, assetId: string) => '/api/app/projects/' + encodeURIComponent(projectId) + '/assets/' + encodeURIComponent(assetId);
/** Transparent areas show as a light checkerboard, as in other image editors. */
export const checker = { background: 'repeating-conic-gradient(#ecebe6 0 25%, #ffffff 0 50%) 0 0 / 16px 16px' };
const clamp = (value: number) => Math.min(2, Math.max(-2, Math.round(value * 10000) / 10000));

/** The stack as it will be saved. Only the selected layer takes the pointer, so it can be dragged even under others. */
export function LayerCanvas({ projectId, stack, selectedId, onMove }: { projectId: string; stack: ImageLayerStack; selectedId: string | null; onMove: (layerId: string, x: number, y: number) => void }) {
  const frame = useRef<HTMLDivElement>(null), drag = useRef<{ id: string; pointer: number; startX: number; startY: number; x: number; y: number; width: number; height: number } | null>(null);
  const ratio = stack.width / stack.height, selectedLayer = stack.layers.find(layer => layer.id === selectedId);
  const percentBox = (layer: ImageLayerStack['layers'][number]) => { const box = layerBox(layer, stack); return { left: box.left / stack.width * 100 + '%', top: box.top / stack.height * 100 + '%', width: box.width / stack.width * 100 + '%', height: box.height / stack.height * 100 + '%' }; };
  return <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden p-4 sm:p-8">
    <div ref={frame} role="img" aria-label={m['ui.layers.canvas']()} className="relative w-full overflow-hidden rounded-lg shadow-[0_0_0_1px_var(--vh-border),0_12px_40px_rgba(17,17,17,0.08)]"
      style={{ ...checker, aspectRatio: stack.width + ' / ' + stack.height, maxWidth: 'min(100%, calc(72vh * ' + ratio + '))' }}>
      {stack.layers.map(layer => {
        const selected = layer.id === selectedId;
        return <img key={layer.id} src={layerUrl(projectId, layer.assetId)} alt="" draggable={false}
          className={cn('absolute max-w-none select-none', selected ? 'cursor-move' : 'pointer-events-none', !layer.visible && 'hidden')}
          style={{ ...percentBox(layer), opacity: layer.opacity, touchAction: 'none' }}
          onPointerDown={event => {
            if (!selected || !frame.current) return;
            const rect = frame.current.getBoundingClientRect();
            drag.current = { id: layer.id, pointer: event.pointerId, startX: event.clientX, startY: event.clientY, x: layer.x, y: layer.y, width: rect.width, height: rect.height };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={event => {
            const moving = drag.current;
            if (moving?.id === layer.id && moving.pointer === event.pointerId) onMove(layer.id, clamp(moving.x + (event.clientX - moving.startX) / moving.width), clamp(moving.y + (event.clientY - moving.startY) / moving.height));
          }}
          onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} />;
      })}
      {/* Drawn inside the box, so the outline stays visible when a layer fills the canvas. */}
      {selectedLayer?.visible && <div aria-hidden="true" className="pointer-events-none absolute rounded-[2px] shadow-[inset_0_0_0_2px_var(--color-brand-lime),inset_0_0_0_3px_rgba(17,17,17,0.35)]" style={percentBox(selectedLayer)} />}
    </div>
  </div>;
}
