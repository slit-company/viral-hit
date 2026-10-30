import { m as uiMessages } from '@/paraglide/messages.js';
import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { Brush, Eraser } from 'lucide-react';
import { Action } from '@/components/base/action';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import { uploadLocalProjectAsset } from '@/core/workspace-lib/app/local-project-asset-client';
import { activeStudioMask } from '@/core/studio/studio-visual-sources';
import type { WorkspaceModelOption } from '@/core/effects/workspace-models';
import type { StudioVisualSourcesController } from './use-studio-visual-sources';
import { drawMaskAsOverlay, exportMask, maskCanvasSize, MASK_OVERLAY_COLOR, paintStroke } from './mask-canvas';

/** Paint the area a mask-capable model may change. The original image is never modified. */
export function StudioMaskEditor({ projectId, model, source, disabled }: { projectId: string; model: WorkspaceModelOption | null; source: StudioVisualSourcesController; disabled: boolean }) {
  const [open, setOpen] = useState(false), [brush, setBrush] = useState(48), [erase, setErase] = useState(false);
  const [saving, setSaving] = useState(false), [error, setError] = useState('');
  const canvas = useRef<HTMLCanvasElement>(null), last = useRef<{ x: number; y: number } | null>(null);
  const target = source.sources.find(item => item.type === 'image');
  const mask = activeStudioMask(source.sources, source.mask);

  useEffect(() => {
    if (!open || !target) return;
    let cancelled = false;
    const image = new Image();
    image.onload = () => {
      const surface = canvas.current;
      if (cancelled || !surface) return;
      Object.assign(surface, maskCanvasSize(image.naturalWidth, image.naturalHeight));
      if (!mask) return;
      const saved = new Image();
      saved.onload = () => { if (!cancelled) drawMaskAsOverlay(surface.getContext('2d')!, saved); };
      saved.src = mask.publicUrl;
    };
    image.src = target.publicUrl;
    return () => { cancelled = true; };
  }, [open, target?.id, mask?.id]);

  if (!model?.maskInput) return null;
  const point = (event: PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: (event.clientX - rect.left) * event.currentTarget.width / rect.width, y: (event.clientY - rect.top) * event.currentTarget.height / rect.height };
  };
  const draw = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!last.current) return;
    const next = point(event), surface = event.currentTarget;
    paintStroke(surface.getContext('2d')!, last.current, next, brush * surface.width / surface.getBoundingClientRect().width, erase);
    last.current = next;
  };
  const fill = (all: boolean) => {
    const surface = canvas.current!, context = surface.getContext('2d')!;
    context.globalCompositeOperation = 'source-over'; context.clearRect(0, 0, surface.width, surface.height);
    if (all) { context.fillStyle = MASK_OVERLAY_COLOR; context.fillRect(0, 0, surface.width, surface.height); }
  };
  async function save() {
    if (!target || !canvas.current) return;
    setSaving(true); setError('');
    try {
      const blob = await exportMask(canvas.current);
      if (!blob) throw Error('Paint the area to change first.');
      const asset = await uploadLocalProjectAsset({ projectId, file: new File([blob], `mask-${target.filename.replace(/\.[^.]+$/, '')}.png`, { type: 'image/png' }), assetClass: 'derived', metadata: { maskFor: target.id } });
      source.setMask({ id: asset.id, publicUrl: asset.publicUrl, targetId: target.id });
      setOpen(false);
    } catch (cause) { setError((cause as Error).message); }
    finally { setSaving(false); }
  }

  return <>
    <Action className="vh-secondary flex shrink-0 items-center gap-1.5" aria-label={mask ? uiMessages["studio.controls.edit_marked_area"]() : uiMessages["studio.controls.mark_area_to_change"]()} disabled={disabled || !target} onClick={() => setOpen(true)}>
      <Brush size={15} />{mask ? uiMessages["studio.controls.area_marked"]() : uiMessages["studio.controls.mark_area"]()}
    </Action>
    {!target && <span className="text-xs text-[var(--vh-text-2)]">{uiMessages["studio.media.add_an_image_to_mark_the_area_to_change_6187"]()}</span>}
    <Dialog open={open} onOpenChange={next => { if (!saving) setOpen(next); }}>
      <DialogContent className="max-h-[calc(100dvh-32px)] max-w-3xl grid-rows-[auto_auto_minmax(0,1fr)_auto_auto]">
        <DialogTitle>{uiMessages["studio.media.mark_the_area_to_change_67e6"]()}</DialogTitle>
        <DialogDescription className="pr-6">{uiMessages["studio.controls.mask_instruction"]({ name: target?.filename ?? "" })}</DialogDescription>
        <div className="flex flex-wrap items-center gap-2">
          <Action className={(erase ? 'vh-secondary' : 'vh-primary') + ' flex items-center gap-1.5'} aria-pressed={!erase} onClick={() => setErase(false)}><Brush size={15} />{uiMessages["studio.media.paint_56d7"]()}</Action>
          <Action className={(erase ? 'vh-primary' : 'vh-secondary') + ' flex items-center gap-1.5'} aria-pressed={erase} onClick={() => setErase(true)}><Eraser size={15} />{uiMessages["studio.media.erase_3cef"]()}</Action>
          <label className="flex items-center gap-2 text-xs text-[var(--vh-text-2)]">{uiMessages["studio.media.brush_size_6c0c"]()}<input type="range" min={8} max={160} step={4} value={brush} aria-label={uiMessages["studio.media.brush_size_6c0c"]()} className="accent-[var(--vh-graph)]" onChange={event => setBrush(Number(event.target.value))} />
          </label>
          <Action className="vh-secondary" onClick={() => fill(true)}>{uiMessages["studio.media.mark_whole_image_5d11"]()}</Action>
          <Action className="vh-secondary" onClick={() => fill(false)}>{uiMessages["studio.media.clear_719e"]()}</Action>
        </div>
        <div className="relative min-h-0 overflow-auto rounded-xl bg-[var(--vh-control)]">
          {target && <div className="relative mx-auto w-fit">
            <img src={target.publicUrl} alt="" className="block max-h-[60dvh] w-auto max-w-full select-none" draggable={false} />
            <canvas ref={canvas} aria-label={uiMessages["studio.media.mask_drawing_area_a1e4"]()} className="absolute inset-0 h-full w-full cursor-crosshair touch-none opacity-80 mix-blend-difference"
              onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); last.current = point(event); draw(event); }}
              onPointerMove={draw} onPointerUp={() => { last.current = null; }} onPointerCancel={() => { last.current = null; }} />
          </div>}
        </div>
        {error && <p role="alert" className="text-xs">{error}</p>}
        <DialogFooter>
          {mask && <Action className="vh-secondary" disabled={saving} onClick={() => { source.setMask(undefined); setOpen(false); }}>{uiMessages["studio.media.remove_mask_7600"]()}</Action>}
          <Action className="vh-secondary" disabled={saving} onClick={() => setOpen(false)}>{uiMessages["studio.media.cancel_77df"]()}</Action>
          <Action className="vh-primary" disabled={saving} onClick={() => void save()}>{saving ? uiMessages["studio.controls.saving"]() : uiMessages["studio.controls.use_mask"]()}</Action>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
