import { useState } from 'react';
import { Layers2, Loader2 } from 'lucide-react';
import { m } from '@/paraglide/messages.js';
import { Action } from '@/components/base/action';
import { downloadBlob } from '@/core/editor/media-export';
import { WORKSPACE_MUTATION_HEADER, WORKSPACE_MUTATION_HEADER_VALUE } from '@/lib/trusted-local-request';

/** Downloads every timeline layer separately (picture, overlays, captions, audio stems) as one ZIP. */
export function LayerExportAction({ projectId, name, disabled, onError }: { projectId: string; name: string; disabled: boolean; onError: (message: string) => void }) {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const response = await fetch(`/api/app/projects/${encodeURIComponent(projectId)}/timeline/layers`, { method: 'POST', headers: { [WORKSPACE_MUTATION_HEADER]: WORKSPACE_MUTATION_HEADER_VALUE } });
      if (!response.ok) throw new Error(((await response.json().catch(() => null)) as { error?: string } | null)?.error ?? m['ui.editor.layers_failed']());
      downloadBlob(await response.blob(), (name.replace(/[^\p{L}\p{N}._-]+/gu, '-') || 'timeline') + '-layers.zip');
    } catch (error) { onError(error instanceof Error ? error.message : m['ui.editor.layers_failed']()); }
    finally { setBusy(false); }
  };
  const label = m['ui.editor.layers']();
  // Icon only below xl, where the editor toolbar has no room for another label.
  return <Action type="button" onClick={() => void run()} disabled={disabled || busy} aria-label={label} aria-busy={busy} title={m['ui.editor.layers_hint']()}
    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--vh-border)] bg-[var(--vh-surface)] px-2.5 text-xs font-semibold text-[var(--vh-text-1)] disabled:opacity-45 xl:px-3">
    {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Layers2 className="size-3.5" />}<span className="hidden xl:inline">{label}</span>
  </Action>;
}
