import { MAX_SKILL_FILE_BYTES } from '@/core/skills/limits';
import { m as uiMessages } from '@/paraglide/messages.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiJsonGet, apiJsonPost } from '@/lib/api-client';
import type { ViralHitSkill, ViralHitSkillCatalog } from '@/core/skills/contract';
import type { SkillInspection, SkillPackage, SkillReview, SkillRemovalReview } from '@/core/skills/package';

export function useSkills() {
  const [catalog, setCatalog] = useState<ViralHitSkillCatalog>();
  const [review, setReview] = useState<SkillReview>();
  const [removal, setRemoval] = useState<SkillRemovalReview>();
  const [detail, setDetail] = useState<ViralHitSkill>();
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const epoch = useRef(0);
  const load = useCallback(async () => { setCatalog(await apiJsonGet<ViralHitSkillCatalog>('/api/app/skills')); }, []);
  useEffect(() => { void load().catch(() => setError(uiMessages["ui.skills.skills_could_not_be_loaded_reload_the_page_to_retry"]())); }, [load]);
  useEffect(() => () => { epoch.current++; }, []);
  async function work<T>(task: () => Promise<T>, apply: (result: T) => void) {
    const current = ++epoch.current; setBusy(true); setError(''); setNotice('');
    try { const result = await task(); if (current === epoch.current) apply(result); }
    catch (cause) { if (current === epoch.current) setError(cause instanceof Error ? cause.message : uiMessages["ui.skills.skill_request_failed"]()); }
    finally { if (current === epoch.current) setBusy(false); }
  }
  function importFile(file?: File) {
    if (!file) return;
    setDetail(undefined); setReview(undefined); setRemoval(undefined);
    return work(async () => {
      if (file.size > MAX_SKILL_FILE_BYTES) throw new Error(uiMessages["ui.skills.skill_files_must_be_700_kb_or_smaller"]());
      let parsed: SkillPackage;
      try { parsed = JSON.parse(await file.text()); } catch { throw new Error(uiMessages["ui.skills.this_file_is_not_valid_json"]()); }
      const inspection = await apiJsonPost<SkillInspection>('/api/app/skills', { action: 'inspect', file: parsed });
      return { file: parsed, inspection };
    }, setReview);
  }
  function fetchLink(url: string, expectedSha256?: string) {
    setDetail(undefined); setReview(undefined); setRemoval(undefined);
    return work(() => apiJsonPost<SkillReview>('/api/app/skills', { action: 'fetch', url: url.trim(), expectedSha256 }), setReview);
  }
  function open(skillId: string) {
    setReview(undefined); setDetail(undefined); setRemoval(undefined);
    return work(() => apiJsonPost<ViralHitSkill>('/api/app/skills', { action: 'get', skillId }), setDetail);
  }
  function install() {
    if (!review) return;
    return work(async () => {
      const update = review.inspection.update;
      await apiJsonPost('/api/app/skills', { action: update ? 'update' : 'install', file: review.file, expectedDigest: review.inspection.digest,
        ...(update ? { expectedInstalledDigest: update.digest } : {}) });
      await load();
      return review.inspection.skill.manifest.title;
    }, title => { setReview(undefined); setNotice(review.inspection.update ? uiMessages["ui.skills.updated_ready"]({ name: title }) : uiMessages["ui.skills.installed_ready"]({ name: title })); });
  }
  function reviewRemoval(skillId: string) {
    return work(() => apiJsonPost<SkillRemovalReview>('/api/app/skills', { action: 'review-remove', skillId }), result => {
      setDetail(undefined); setReview(undefined); setRemoval(result);
    });
  }
  function remove() {
    if (!removal) return;
    return work(async () => {
      await apiJsonPost('/api/app/skills', { action: 'remove', skillId: removal.file.manifest.id, expectedDigest: removal.digest });
      await load();
      return removal.file.manifest.title;
    }, title => { setRemoval(undefined); setNotice(uiMessages["ui.skills.removed"]({ name: title })); });
  }
  function download(skillId: string, retained?: SkillPackage) {
    return work(() => retained ? Promise.resolve(retained) : apiJsonPost<SkillPackage>('/api/app/skills', { action: 'export', skillId }), file => {
      const url = URL.createObjectURL(new Blob([JSON.stringify(file, null, 2) + '\n'], { type: 'application/json' }));
      const a = document.createElement('a'); a.href = url; a.download = file.manifest.id + '.viralhit-skill.json'; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  }
  return { catalog, review, detail, removal, busy, error, notice, importFile, fetchLink, open, install, download, reviewRemoval, remove,
    close: () => { epoch.current++; setReview(undefined); setDetail(undefined); setRemoval(undefined); setError(''); setBusy(false); } };
}
