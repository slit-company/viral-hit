import { m as uiMessages } from '@/paraglide/messages.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ExtensionDiagnostics } from '@/core/extensions/contract';

export function useExtensionDiagnostics() {
  const [data, setData] = useState<ExtensionDiagnostics | null>(null);
  const [busy, setBusy] = useState(true), [error, setError] = useState('');
  const active = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    active.current?.abort();
    const controller = new AbortController(); active.current = controller;
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/app/extensions', { cache: 'no-store', signal: controller.signal });
      if (!response.ok) throw new Error(uiMessages["ui.extensions.extension_status_is_unavailable_try_refreshing"]());
      const next = await response.json() as ExtensionDiagnostics;
      if (!controller.signal.aborted) setData(next);
    } catch (error) {
      if (!controller.signal.aborted) setError(error instanceof Error ? error.message : uiMessages["ui.extensions.extension_status_is_unavailable"]());
    } finally { if (!controller.signal.aborted) setBusy(false); }
  }, []);
  useEffect(() => { void refresh(); return () => active.current?.abort(); }, [refresh]);
  return { data, busy, error, refresh };
}
