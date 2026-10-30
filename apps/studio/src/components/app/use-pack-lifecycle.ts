import { m as uiMessages } from '@/paraglide/messages.js';
import { useEffect, useRef, useState } from 'react';
import { apiJsonPost } from '@/lib/api-client';
import type { PackStateReview, PackUpdateReview } from '@/core/harness/recipe-pack-lifecycle-contract';
import type { PackSummary } from '@/core/harness/recipe-packs';

type Review = { kind: 'update'; state: PackUpdateReview; manifest: unknown } | { kind: 'remove'; state: PackStateReview };
export function usePackLifecycle(onChanged: (kind: Review['kind'], pack: PackSummary) => Promise<void>) {
  const [review, setReview] = useState<Review>();
  const [selected, setSelected] = useState<string[]>([]), [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const epoch = useRef(0);
  useEffect(() => () => { epoch.current++; }, []);
  function dismiss() { epoch.current++; setReview(undefined); setSelected([]); setConfirmed(false); setBusy(false); setError(''); }
  async function inspect(kind: Review['kind'], value: unknown) {
    dismiss(); const current = ++epoch.current; setBusy(true);
    try {
      const next: Review = kind === 'update'
        ? { kind, manifest: value, state: await apiJsonPost<PackUpdateReview>('/api/app/recipe-packs', { action: 'review-update', pack: value }) }
        : { kind, state: await apiJsonPost<PackStateReview>('/api/app/recipe-packs', { action: 'review-remove', packId: value }) };
      if (current === epoch.current) setReview(next);
    } catch (cause) { if (current === epoch.current) setError(cause instanceof Error ? cause.message : uiMessages["ui.app.could_not_review_pack_change"]()); }
    finally { if (current === epoch.current) setBusy(false); }
  }
  function toggle(id: string) {
    setSelected(previous => previous.includes(id) ? previous.filter(item => item !== id) : [...previous, id]);
    setConfirmed(false);
  }
  async function apply() {
    if (!review || !confirmed || busy) return;
    const current = ++epoch.current; setBusy(true); setError('');
    try {
      const request = review.kind === 'update'
        ? { action: 'update', pack: review.manifest, expectedDigest: review.state.incoming.digest, expectedStateDigest: review.state.stateDigest, replaceRecipeIds: selected }
        : { action: 'remove', packId: review.state.pack.id, expectedStateDigest: review.state.stateDigest, deleteRecipeIds: selected };
      await apiJsonPost('/api/app/recipe-packs', request);
      if (current === epoch.current) {
        setReview(undefined); setConfirmed(false); setSelected([]);
        await onChanged(review.kind, review.kind === 'update' ? review.state.incoming : review.state.pack);
      }
    } catch (cause) { if (current === epoch.current) setError(cause instanceof Error ? cause.message : uiMessages["ui.app.could_not_change_pack"]()); }
    finally { if (current === epoch.current) setBusy(false); }
  }
  function download() {
    if (!review) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(review.state, null, 2) + '\n'], { type: 'application/json' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = review.state.pack.id + '-review.json'; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return { review, selected, confirmed, setConfirmed, busy, error, dismiss, inspect, toggle, apply, download };
}
export type PackLifecycleState = ReturnType<typeof usePackLifecycle>;
