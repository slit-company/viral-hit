import { MAX_CREATIVE_PACK_BYTES } from '@/core/creative-packs/limits';
import { m as uiMessages } from '@/paraglide/messages.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { packContentsLabel } from './pack-labels';
import type { CreativeLifecycleReview, CreativeReleaseHistory } from '@/core/creative-packs/lifecycle-contract';
import { apiJsonGet, apiJsonPost } from '@/lib/api-client';
import type { CreativePackBuild, CreativePackCatalog, CreativePackInspection, CreativePackResult } from '@/core/creative-packs/contract';

const headers = { 'x-viral-hit-workspace-request': '1' };
async function readJson<T>(response: Response): Promise<T> {
  const data = await response.json(); if (!response.ok) throw new Error(data.error || uiMessages["ui.creative-packs.pack_request_failed"]()); return data;
}
export function useCreativePacks() {
  const [catalog, setCatalog] = useState<CreativePackCatalog>(), [review, setReview] = useState<CreativePackInspection>();
  const [maintenance, setMaintenance] = useState<{ kind: 'history'; data: CreativeReleaseHistory } | { kind: 'remove'; data: CreativeLifecycleReview }>();
  const [partial, setPartial] = useState<CreativePackResult>();
  const [activity, setActivity] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [source, setSource] = useState(''), [previews, setPreviews] = useState<Record<string, string>>({});
  const file = useRef<File | undefined>(undefined), urls = useRef<string[]>([]), active = useRef<AbortController | null>(null);
  const clearUrls = useCallback(() => { urls.current.forEach(URL.revokeObjectURL); urls.current = []; }, []);
  const load = useCallback(async () => { setCatalog(await apiJsonGet<CreativePackCatalog>('/api/app/creative-packs')); }, []);
  useEffect(() => {
    void load().catch(error => setError(error.message));
    return () => { active.current?.abort(); file.current = undefined; clearUrls(); };
  }, [load, clearUrls]);
  const dismiss = () => { setMaintenance(undefined); setPartial(undefined); file.current = undefined; clearUrls(); setSource(''); setPreviews({}); setReview(undefined); setError(''); };
  async function run(label: string, task: (signal: AbortSignal) => Promise<void>) {
    active.current?.abort();
    const controller = new AbortController(); active.current = controller;
    setActivity(label); setError(''); setNotice('');
    try { await task(controller.signal); }
    catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : uiMessages["ui.creative-packs.pack_request_failed"]()); }
    finally { if (active.current === controller) { active.current = null; setActivity(''); } }
  }
  async function inspectFile(incoming: File, signal: AbortSignal, from = '') {
    if (incoming.size > MAX_CREATIVE_PACK_BYTES) throw new Error(uiMessages["ui.creative-packs.creative_packs_must_be_512_mb_or_smaller"]());
    setActivity(uiMessages["ui.creative-packs.reading_and_verifying_pack_contents"]());
    const result = await readJson<CreativePackInspection>(await fetch('/api/app/creative-packs/file?action=inspect', {
      method: 'POST', headers: { ...headers, 'content-type': 'application/x-tar' }, body: incoming, signal,
    }));
    signal.throwIfAborted();
    const images: Record<string, string> = {};
    for (const character of result.characters) for (const image of character.previews) {
      if (images[image.sha256]) continue;
      const reference = character.manifest.references.find(item => item.sha256 === image.sha256)!;
      images[image.sha256] = URL.createObjectURL(incoming.slice(image.offset, image.offset + image.size, reference.mimeType));
      urls.current.push(images[image.sha256]);
    }
    file.current = incoming; setSource(from); setPreviews(images); setReview(result);
  }
  async function inspect(incoming?: File) {
    if (!incoming) return;
    dismiss();
    await run(uiMessages["ui.creative-packs.reading_and_verifying_pack_contents"](), signal => inspectFile(incoming, signal));
  }
  async function fetchLink(raw: string, expectedSha256?: string) {
    dismiss();
    await run(uiMessages["ui.creative-packs.downloading_shared_pack"](), async signal => {
      const response = await fetch('/api/app/creative-packs', {
        method: 'POST', headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'fetch', url: raw.trim(), expectedSha256 }), signal,
      });
      if (!response.ok) { await readJson(response); return; }
      if (Number(response.headers.get('content-length')) > MAX_CREATIVE_PACK_BYTES) throw new Error(uiMessages["ui.creative-packs.creative_packs_must_be_512_mb_or_smaller"]());
      // Keep one browser Blob/File; no whole-archive ArrayBuffer, extraction or persistent server cache.
      const blob = await response.blob(); signal.throwIfAborted();
      const sourceUrl = new URL(raw.trim());
      await inspectFile(new File([blob], 'shared-pack.viralhit-pack.tar', { type: 'application/x-tar' }), signal, sourceUrl.origin + sourceUrl.pathname);
    });
  }
  async function install() {
    if (!file.current || !review) return;
    const retainedFile = file.current, digest = review.pack.digest;
    await run(uiMessages["ui.common.installing"](), async signal => {
      const result = await readJson<CreativePackResult>(await fetch('/api/app/creative-packs/file?action=install&digest=' + digest, {
        method: 'POST', headers: { ...headers, 'content-type': 'application/x-tar' }, body: retainedFile, signal,
      }));
      signal.throwIfAborted(); await load(); signal.throwIfAborted();
      if (!result.complete) { setError(uiMessages["ui.creative-packs.install_incomplete"]({ count: result.items.length, error: result.error ?? "" })); return; }
      dismiss(); setNotice(uiMessages["ui.creative-packs.pack_ready"]({ name: result.pack.title, contents: packContentsLabel(result.pack) }));
    });
  }
  async function refreshReview() {
    if (!file.current) return;
    const retained = file.current;
    await run(uiMessages["ui.creative-packs.reading_and_verifying_pack_contents"](), async signal => { clearUrls(); await inspectFile(retained, signal, source); });
  }
  async function update(replaceKeys: string[]) {
    if (!file.current || !review?.update) return;
    const retained = file.current, checked = review;
    await run(uiMessages["ui.creative-packs.updating_creative_pack"](), async signal => {
      const result = await readJson<CreativePackResult>(await fetch('/api/app/creative-packs/file?action=update&digest=' + checked.pack.digest, {
        method: 'POST', headers: { ...headers, 'content-type': 'application/x-tar', 'x-viral-hit-pack-update': JSON.stringify({ expectedStateDigest: checked.update!.stateDigest, replaceKeys }) }, body: retained, signal,
      }));
      signal.throwIfAborted(); await load(); signal.throwIfAborted();
      if (!result.complete) {
        setPartial(result); clearUrls(); await inspectFile(retained, signal, source);
        setError(uiMessages["ui.creative-packs.update_is_incomplete_applied_items_remain_available_the_previous_release_is"]() + result.error); return;
      }
      dismiss(); setNotice(uiMessages["ui.creative-packs.pack_updated"]({ name: result.pack.title }));
    });
  }
  async function reviewMaintenance(kind: 'history' | 'remove', id: string) {
    dismiss();
    await run(uiMessages["ui.creative-packs.reading_retained_pack"](), async signal => {
      const result = kind === 'history'
        ? { kind, data: await apiJsonPost<CreativeReleaseHistory>('/api/app/creative-packs', { action: 'history', id }) }
        : { kind, data: await apiJsonPost<CreativeLifecycleReview>('/api/app/creative-packs', { action: 'review-remove', id }) };
      signal.throwIfAborted(); setMaintenance(result);
    });
  }
  async function remove() {
    if (maintenance?.kind !== 'remove') return;
    const checked = maintenance.data;
    await run(uiMessages["ui.creative-packs.removing_pack_listing"](), async signal => {
      await apiJsonPost('/api/app/creative-packs', { action: 'remove', id: checked.current.id, expectedStateDigest: checked.stateDigest });
      signal.throwIfAborted(); await load(); signal.throwIfAborted(); dismiss();
      setNotice(uiMessages["ui.creative-packs.pack_removed"]({ name: checked.current.title }));
    });
  }
  async function download(request: { action: 'build'; pack: CreativePackBuild } | { action: 'export'; id: string; digest?: string }) {
    await run(uiMessages["ui.creative-packs.preparing_pack_download"](), async signal => {
      const response = await fetch('/api/app/creative-packs', { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(request), signal });
      if (!response.ok) { await readJson(response); return; }
      const blob = await response.blob(); signal.throwIfAborted();
      const url = URL.createObjectURL(blob), a = document.createElement('a');
      a.href = url; a.download = (request.action === 'build' ? request.pack.id : request.id) + '.viralhit-pack.tar'; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice(uiMessages["ui.creative-packs.pack_file_downloaded_it_contains_the_selected_definitions_and_character_ima"]());
    });
  }
  function cancelRead() {
    if (![uiMessages["ui.creative-packs.downloading_shared_pack"](), uiMessages["ui.creative-packs.reading_and_verifying_pack_contents"]()].some(label => label === activity)) return;
    active.current?.abort(); active.current = null; setActivity(''); dismiss(); setNotice(uiMessages["ui.creative-packs.pack_review_stopped"]());
  }
  return { catalog, review, source, previews, maintenance, partial, update, refreshReview, reviewMaintenance, remove, busy: !!activity, activity, error, notice, inspect, fetchLink, install, download, dismiss, cancelRead,
    canCancel: [uiMessages["ui.creative-packs.downloading_shared_pack"](), uiMessages["ui.creative-packs.reading_and_verifying_pack_contents"]()].some(label => label === activity) };
}
export type CreativePackLibrary = ReturnType<typeof useCreativePacks>;
