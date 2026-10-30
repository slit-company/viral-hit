import { m as uiMessages } from '@/paraglide/messages.js';
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
      if (!backupError.current) o.onError(uiMessages["ui.editor.backup_unavailable"]({ error: error instanceof Error ? error.message : uiMessages["ui.editor.browser_storage_error"]() }));
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
    } catch { journal.current = null; latest.current.onError(uiMessages["ui.editor.browser_draft_storage_is_unavailable_keep_this_tab_open_until_the_timeline_"]()); }
    return () => { backup(); lifecycle.current++; };
  }, [options.projectId]);
  useEffect(() => { backup(); }, [options.document, options.hydrated, options.projectId]);
  const closeDrafts = () => { if (recovering) return; reviewing.current = false; setDraftReviewOpen(false); void saveRef.current(); };
  const openDrafts = () => {
    if (busy.current) { latest.current.onError(uiMessages["ui.editor.wait_for_the_current_save_before_reviewing_local_drafts"]()); return; }
    backup();
    try { scanDrafts(); reviewing.current = true; setDraftReviewOpen(true); } catch { latest.current.onError(uiMessages["ui.editor.local_drafts_could_not_be_read"]()); }
  };
  const discardDraft = (record: DraftRecord) => {
    try {
      if (!journal.current?.remove(record)) throw new Error(uiMessages["ui.editor.this_draft_changed_in_another_tab_reload_the_draft_list_before_removing_it"]());
      scanDrafts();
    } catch (error) { setDraftError(error instanceof Error ? error.message : uiMessages["ui.editor.could_not_remove_draft"]()); }
  };
  const restoreDraft = async (record: DraftRecord) => {
    const o = latest.current, j = journal.current;
    if (!j || !o.hydrated || !o.savedRef.current || !o.documentRef.current) return;
    if (!equal(o.documentRef.current, o.savedRef.current)) { setDraftError(uiMessages["ui.editor.save_or_undo_the_current_tab_s_edits_before_restoring_another_draft_continu"]()); return; }
    const current = o.documentRef.current, generation = lifecycle.current;
    setRecovering(true); setDraftError('');
    try {
      const remote = (await apiJsonGet<{ timeline: TimelineState | null }>(`/api/app/projects/${encodeURIComponent(o.projectId)}/timeline`)).timeline;
      if (lifecycle.current !== generation || latest.current.projectId !== o.projectId || !equal(o.documentRef.current!, current)) throw new Error(uiMessages["ui.editor.the_editor_changed_while_loading_review_the_draft_again"]());
      const merged = mergeTimelineDraft(record.draft, remote);
      if (merged.conflicts.length) {
        const clips = record.draft.document.tracks.flatMap(track => track.clips);
        const descriptions = [...new Set(merged.conflicts.map(({ path }) => {
          const clip = clips.find(clip => path.includes(`.clips[${clip.id}]`));
          return clip ? `${clip.sourceType === 'caption' ? uiMessages["ui.editor.caption"]() : uiMessages["ui.editor.clip"]()} “${clip.name.slice(0, 80)}”` : uiMessages["ui.editor.timeline_settings"]();
        }))];
        throw new Error(uiMessages["ui.editor.merge_conflicts"]({ fields: descriptions.slice(0, 4).join(', ') }));
      }
      // Keep a new independent recovery copy before applying/removing the old snapshot.
      ownDraft.current = j.write(merged.baseline, merged.document, merged.version);
      retiredOnSave.current.push(record);
      o.versionRef.current = merged.version; o.savedRef.current = merged.baseline; o.documentRef.current = merged.document;
      o.onRemote(merged.document, !equal(merged.document, merged.baseline)); o.onStatus(equal(merged.document, merged.baseline) ? 'saved' : 'saving');
      reviewing.current = false; setDraftReviewOpen(false);
      if (equal(merged.document, merged.baseline)) { j.remove(record); retiredOnSave.current = []; backup(); }
      else void saveRef.current();
    } catch (error) { if (lifecycle.current === generation) setDraftError(error instanceof Error ? error.message : uiMessages["ui.editor.draft_recovery_failed"]()); }
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
          if (merged.conflicts.length) throw new Error(uiMessages["ui.editor.edit_conflict"]({ path: merged.conflicts[0].path }));
          saved = await saveTimelineThroughCommand({ projectId, document: merged.document, baseDocument: remote.document, expectedRevision: remote.version });
        }
        if (!active) return;
        const current = o.documentRef.current ?? candidate;
        const rebase = equal(current, candidate) ? { document: saved.document, conflicts: [] } : mergeTimelineDocuments({ base: candidate, local: current, remote: saved.document });
        if (rebase.conflicts.length) throw new Error(uiMessages["ui.editor.concurrent_edits_overlap_your_latest_changes_remain_in_this_tab_and_its_loc"]());
        const rebased = rebase.document;
        o.versionRef.current = saved.version;
        o.savedRef.current = saved.document;
        o.documentRef.current = rebased;
        latest.current.onDocument(rebased);
        o.onStatus(equal(rebased, saved.document) ? 'saved' : 'saving');
        succeeded = true;
        try { for (const draft of retiredOnSave.current) journal.current?.remove(draft); retiredOnSave.current = []; }
        catch { o.onError(uiMessages["ui.editor.timeline_saved_but_an_old_local_draft_could_not_be_removed_it_remains_avail"]()); }
        backup();
      } catch (error) {
        if (active) {
          o.onStatus('idle');
          o.onError(error instanceof Error ? error.message : uiMessages["ui.editor.save_failed"]());
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
  return { checkpoint: backup, canRestore: options.hydrated, drafts, draftReviewOpen, draftError, recovering, openDrafts, closeDrafts, restoreDraft, discardDraft, reloadDrafts: () => { try { scanDrafts(); } catch { setDraftError(uiMessages["ui.editor.local_draft_storage_could_not_be_read_existing_drafts_have_not_been_deleted"]()); } } };
}
