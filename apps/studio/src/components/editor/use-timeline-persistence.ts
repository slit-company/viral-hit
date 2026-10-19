import { TimelineDraftJournal, mergeTimelineDraft, type DraftRecord } from '@/core/editor/timeline-drafts';
import { useEffect, useRef, useState, type RefObject } from 'react';
import type { TimelineDocument } from '@/core/editor/timeline-document';
import { mergeTimelineDocuments } from '@/core/editor/timeline-merge';
import { saveTimelineThroughCommand, timelineDocumentsEqualForPersistence as equal } from '@/core/editor/timeline-persistence';
import { hasNewProjectRevision } from '@/core/projects/revision-client';
import { apiJsonGet } from '@/lib/api-client';

type TimelineState = { document: TimelineDocument; version: number };
type Options = {
  projectId: string;
  document: TimelineDocument;
  hydrated: boolean;
  documentRef: RefObject<TimelineDocument | null>;
  versionRef: RefObject<number | null>;
  savedRef: RefObject<TimelineDocument | null>;
  onDocument: (document: TimelineDocument) => void;
  onRemote: (document: TimelineDocument, restored?: boolean) => void;
  onStatus: (status: 'idle' | 'saving' | 'saved') => void;
  onError: (message: string) => void;
};

export function useTimelinePersistence(options: Options) {
  const latest = useRef(options);
  latest.current = options;
  const busy = useRef(false);
  const polling = useRef(false);
  const saveRef = useRef<() => Promise<void>>(async () => {});

  const journal = useRef<TimelineDraftJournal | null>(null);
  const ownDraft = useRef<DraftRecord | null>(null);
  const retiredOnSave = useRef<DraftRecord[]>([]);
  const reviewing = useRef(false);
  const pendingSave = useRef(false);
  const [drafts, setDrafts] = useState<DraftRecord[]>([]);
  const [draftReviewOpen, setDraftReviewOpen] = useState(false);
  const [draftError, setDraftError] = useState('');
  const [recovering, setRecovering] = useState(false);
  const backupError = useRef(false);
  const lifecycle = useRef(0);
  const backup = () => {
    const o = latest.current, j = journal.current;
    if (!j || reviewing.current || !o.hydrated || !o.documentRef.current || !o.savedRef.current || o.documentRef.current.projectId !== j.projectId) return;
    try {
      if (equal(o.documentRef.current, o.savedRef.current)) {
        if (ownDraft.current && equal(ownDraft.current.draft.document, o.savedRef.current)) {
          j.remove(ownDraft.current); ownDraft.current = null;
        }
      } else ownDraft.current = j.write(o.savedRef.current, o.documentRef.current, o.versionRef.current ?? 0);
      backupError.current = false;
    } catch (error) {
      if (!backupError.current) o.onError(`Local draft backup unavailable: ${error instanceof Error ? error.message : 'browser storage error'}. Keep this tab open until the timeline is saved.`);
      backupError.current = true;
    }
  };
  const scanDrafts = () => {
    const result = journal.current?.list();
    setDrafts(result?.records ?? []);
    setDraftError(result?.unreadable ? `${result.unreadable} unreadable draft(s) remain in browser storage. They have not been deleted.` : '');
    return result?.records ?? [];
  };
  useEffect(() => {
    lifecycle.current++; setRecovering(false); setDrafts([]); setDraftReviewOpen(false); setDraftError('');
    ownDraft.current = null; retiredOnSave.current = []; reviewing.current = false; backupError.current = false;
    try {
      journal.current = new TimelineDraftJournal(window.localStorage, options.projectId, crypto.randomUUID());
      const records = scanDrafts(); reviewing.current = records.length > 0; setDraftReviewOpen(records.length > 0);
    } catch { journal.current = null; latest.current.onError('Browser draft storage is unavailable. Keep this tab open until the timeline is saved.'); }
    return () => { backup(); lifecycle.current++; };
  }, [options.projectId]);
  useEffect(() => { backup(); }, [options.document, options.hydrated, options.projectId]);
  const closeDrafts = () => { if (recovering) return; reviewing.current = false; setDraftReviewOpen(false); void saveRef.current(); };
  const openDrafts = () => {
    if (busy.current) { latest.current.onError('Wait for the current save before reviewing local drafts.'); return; }
    backup();
    try { scanDrafts(); reviewing.current = true; setDraftReviewOpen(true); } catch { latest.current.onError('Local drafts could not be read.'); }
  };
  const discardDraft = (record: DraftRecord) => {
    try {
      if (!journal.current?.remove(record)) throw new Error('This draft changed in another tab. Reload the draft list before removing it.');
      scanDrafts();
    } catch (error) { setDraftError(error instanceof Error ? error.message : 'Could not remove draft'); }
  };
  const restoreDraft = async (record: DraftRecord) => {
    const o = latest.current, j = journal.current;
    if (!j || !o.hydrated || !o.savedRef.current || !o.documentRef.current) return;
    if (!equal(o.documentRef.current, o.savedRef.current)) { setDraftError('Save or undo the current tab’s edits before restoring another draft. Continue editing to finish saving.'); return; }
    const current = o.documentRef.current, generation = lifecycle.current;
    setRecovering(true); setDraftError('');
    try {
      const remote = (await apiJsonGet<{ timeline: TimelineState | null }>(`/api/app/projects/${encodeURIComponent(o.projectId)}/timeline`)).timeline;
      if (lifecycle.current !== generation || latest.current.projectId !== o.projectId || !equal(o.documentRef.current!, current)) throw new Error('The editor changed while loading. Review the draft again.');
      const merged = mergeTimelineDraft(record.draft, remote);
      if (merged.conflicts.length) {
        const clips = record.draft.document.tracks.flatMap(track => track.clips);
        const descriptions = [...new Set(merged.conflicts.map(({ path }) => {
          const clip = clips.find(clip => path.includes(`.clips[${clip.id}]`));
          return clip ? `${clip.sourceType === 'caption' ? 'Caption' : 'Clip'} “${clip.name.slice(0, 80)}”` : 'Timeline settings';
        }))];
        throw new Error(`Both versions changed: ${descriptions.slice(0, 4).join(', ')}. Nothing was overwritten. Download the draft to retain its values, or continue with the saved timeline.`);
      }
      // Keep a new independent recovery copy before applying/removing the old snapshot.
      ownDraft.current = j.write(merged.baseline, merged.document, merged.version);
      retiredOnSave.current.push(record);
      o.versionRef.current = merged.version; o.savedRef.current = merged.baseline; o.documentRef.current = merged.document;
      o.onRemote(merged.document, !equal(merged.document, merged.baseline)); o.onStatus(equal(merged.document, merged.baseline) ? 'saved' : 'saving');
      reviewing.current = false; setDraftReviewOpen(false);
      if (equal(merged.document, merged.baseline)) { j.remove(record); retiredOnSave.current = []; backup(); }
      else void saveRef.current();
    } catch (error) { if (lifecycle.current === generation) setDraftError(error instanceof Error ? error.message : 'Draft recovery failed'); }
    finally { if (lifecycle.current === generation) setRecovering(false); }
  };

  useEffect(() => {
    let active = true;
    const generation = lifecycle.current; busy.current = false; polling.current = false; pendingSave.current = false;
    const projectId = options.projectId;
    const load = () => apiJsonGet<{ timeline: TimelineState | null }>(
      `/api/app/projects/${encodeURIComponent(projectId)}/timeline`
    );
    const save = async (keepalive = false) => {
      const o = latest.current;
      const candidate = o.documentRef.current;
      const base = o.savedRef.current;
      if (!active || reviewing.current || !o.hydrated || !candidate || (base && equal(candidate, base))) return;
      backup();
      if (busy.current) { pendingSave.current = true; return; }
      pendingSave.current = false;
      let succeeded = false;
      busy.current = true;
      o.onStatus('saving');
      try {
        let saved: TimelineState;
        try {
          saved = await saveTimelineThroughCommand({ projectId, document: candidate, baseDocument: base, expectedRevision: o.versionRef.current, keepalive });
        } catch (error) {
          if ((error as { code?: string }).code !== 'REVISION_CONFLICT' || !base) throw error;
          const remote = (await load()).timeline;
          if (!remote) throw error;
          const merged = mergeTimelineDocuments({ base, local: candidate, remote: remote.document });
          if (merged.conflicts.length) throw new Error(`Timeline edit conflict at ${merged.conflicts[0].path}. Your local edit is still open.`);
          saved = await saveTimelineThroughCommand({ projectId, document: merged.document, baseDocument: remote.document, expectedRevision: remote.version });
        }
        if (!active) return;
        const current = o.documentRef.current ?? candidate;
        const rebase = equal(current, candidate) ? { document: saved.document, conflicts: [] } : mergeTimelineDocuments({ base: candidate, local: current, remote: saved.document });
        if (rebase.conflicts.length) throw new Error('Concurrent edits overlap. Your latest changes remain in this tab and its local draft; the saved timeline was not overwritten by those changes.');
        const rebased = rebase.document;
        o.versionRef.current = saved.version;
        o.savedRef.current = saved.document;
        o.documentRef.current = rebased;
        latest.current.onDocument(rebased);
        o.onStatus(equal(rebased, saved.document) ? 'saved' : 'saving');
        succeeded = true;
        try { for (const draft of retiredOnSave.current) journal.current?.remove(draft); retiredOnSave.current = []; }
        catch { o.onError('Timeline saved, but an old local draft could not be removed. It remains available for review.'); }
        backup();
      } catch (error) {
        if (active) {
          o.onStatus('idle');
          o.onError(error instanceof Error ? error.message : 'The timeline could not be saved.');
        }
      } finally {
        if (lifecycle.current !== generation) return;
        busy.current = false;
        const o = latest.current;
        const dirty = o.documentRef.current && o.savedRef.current && !equal(o.documentRef.current, o.savedRef.current);
        if (active && succeeded && (pendingSave.current || dirty)) queueMicrotask(() => void saveRef.current());
        pendingSave.current = false;
      }
    };
    saveRef.current = save;
    const poll = async () => {
      if (!active || reviewing.current || globalThis.document.visibilityState === 'hidden' || busy.current || polling.current) return;
      const o = latest.current;
      if (!o.hydrated || !o.savedRef.current || !o.documentRef.current || !equal(o.savedRef.current, o.documentRef.current)) return;
      polling.current = true;
      try {
        if (!await hasNewProjectRevision(projectId, 'timeline', o.versionRef.current)) return;
        const remote = (await load()).timeline;
        if (!active || busy.current || !remote || (o.versionRef.current !== null && remote.version <= o.versionRef.current)) return;
        if (!o.documentRef.current || !o.savedRef.current || !equal(o.documentRef.current, o.savedRef.current)) return;
        o.versionRef.current = remote.version;
        o.savedRef.current = remote.document;
        o.documentRef.current = remote.document;
        latest.current.onRemote(remote.document);
      } finally {
        if (lifecycle.current === generation) polling.current = false;
      }
    };
    const refresh = () => { void poll().catch(() => {}); };
    const flush = () => { backup(); void save(true); };
    const beforeUnload = (event: BeforeUnloadEvent) => {
      const o = latest.current;
      if (o.hydrated && o.documentRef.current && (!o.savedRef.current || !equal(o.documentRef.current, o.savedRef.current))) {
        event.preventDefault();
        event.returnValue = '';
        flush();
      }
    };
    const visibility = () => globalThis.document.visibilityState === 'hidden' ? flush() : refresh();
    const timer = window.setInterval(refresh, 2_000);
    window.addEventListener('focus', refresh);
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', beforeUnload);
    globalThis.document.addEventListener('visibilitychange', visibility);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('beforeunload', beforeUnload);
      globalThis.document.removeEventListener('visibilitychange', visibility);
    };
  }, [options.projectId]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void saveRef.current(); }, 700);
    return () => window.clearTimeout(timer);
  }, [options.document, options.hydrated, options.projectId]);
  return { checkpoint: backup, canRestore: options.hydrated, drafts, draftReviewOpen, draftError, recovering, openDrafts, closeDrafts, restoreDraft, discardDraft, reloadDrafts: () => { try { scanDrafts(); } catch { setDraftError('Local draft storage could not be read. Existing drafts have not been deleted.'); } } };
}
