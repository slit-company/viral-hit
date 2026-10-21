import { useCallback, useEffect, useRef, useState } from 'react';
import { apiJsonGet } from '@/lib/api-client';
import { MAX_CREATIVE_PACK_BYTES, type CreativePackBuild, type CreativePackCatalog, type CreativePackInspection, type CreativePackResult } from '@/core/creative-packs/contract';

const headers = { 'x-viral-hit-workspace-request': '1' };
async function readJson<T>(response: Response): Promise<T> {
  const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Pack request failed'); return data;
}
export function useCreativePacks() {
  const [catalog, setCatalog] = useState<CreativePackCatalog>(), [review, setReview] = useState<CreativePackInspection>();
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const file = useRef<File | undefined>(undefined), urls = useRef<string[]>([]);
  const clearUrls = useCallback(() => { urls.current.forEach(URL.revokeObjectURL); urls.current = []; }, []);
  const load = useCallback(async () => { setCatalog(await apiJsonGet<CreativePackCatalog>('/api/app/creative-packs')); }, []);
  useEffect(() => { void load().catch(error => setError(error.message)); return clearUrls; }, [load, clearUrls]);
  const dismiss = () => { file.current = undefined; clearUrls(); setPreviews({}); setReview(undefined); setError(''); };
  async function inspect(incoming?: File) {
    if (!incoming) return;
    dismiss(); setNotice('');
    if (incoming.size > MAX_CREATIVE_PACK_BYTES) { setError('Creative packs must be 512 MB or smaller.'); return; }
    setBusy(true);
    try {
      const result = await readJson<CreativePackInspection>(await fetch('/api/app/creative-packs/file?action=inspect', { method: 'POST', headers: { ...headers, 'content-type': 'application/x-tar' }, body: incoming }));
      const images: Record<string, string> = {};
      for (const character of result.characters) for (const image of character.previews) {
        if (images[image.sha256]) continue;
        const reference = character.manifest.references.find(item => item.sha256 === image.sha256)!;
        images[image.sha256] = URL.createObjectURL(incoming.slice(image.offset, image.offset + image.size, reference.mimeType)); urls.current.push(images[image.sha256]);
      }
      file.current = incoming; setPreviews(images); setReview(result);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not review this pack'); }
    finally { setBusy(false); }
  }
  async function install() {
    if (!file.current || !review) return;
    setBusy(true); setError('');
    try {
      const result = await readJson<CreativePackResult>(await fetch('/api/app/creative-packs/file?action=install&digest=' + review.pack.digest, { method: 'POST', headers: { ...headers, 'content-type': 'application/x-tar' }, body: file.current }));
      await load();
      if (!result.complete) { setError('Installation is incomplete. ' + result.items.length + ' item groups are available. ' + result.error + ' Retry this file to continue.'); return; }
      dismiss(); setNotice(result.pack.title + ' is ready: ' + result.pack.recipeCount + ' recipes, ' + result.pack.skillCount + ' skills and ' + result.pack.characterCount + ' characters.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not install this pack'); }
    finally { setBusy(false); }
  }
  async function download(request: { action: 'build'; pack: CreativePackBuild } | { action: 'export'; id: string }) {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/app/creative-packs', { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(request) });
      if (!response.ok) { await readJson(response); return; }
      const blob = await response.blob(), url = URL.createObjectURL(blob), a = document.createElement('a');
      a.href = url; a.download = (request.action === 'build' ? request.pack.id : request.id) + '.viralhit-pack.tar'; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice('Pack file downloaded. It contains the selected definitions and character images.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not download this pack'); }
    finally { setBusy(false); }
  }
  return { catalog, review, previews, busy, error, notice, inspect, install, download, dismiss };
}
export type CreativePackLibrary = ReturnType<typeof useCreativePacks>;
