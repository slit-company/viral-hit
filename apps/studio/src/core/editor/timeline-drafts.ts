import { normalizeTimelineDocument, type TimelineDocument } from './timeline-document';
import { mergeTimelineDocuments } from './timeline-merge';

export type TimelineDraft = { schemaVersion: 1; id: string; projectId: string; updatedAt: number; baseVersion: number; base: TimelineDocument; document: TimelineDocument };
export type DraftRecord = { draft: TimelineDraft; serialized: string };
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;
const prefix = (projectId: string) => `viral-hit:timeline-draft:v1:${encodeURIComponent(projectId)}:`;
const MAX_BYTES = 4 * 1024 * 1024;
function parse(serialized: string, projectId: string): TimelineDraft {
  if (new TextEncoder().encode(serialized).byteLength > MAX_BYTES) throw new Error('Local draft exceeds 4 MiB');
  const raw = JSON.parse(serialized);
  if (raw.schemaVersion !== 1 || typeof raw.id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(raw.id) || raw.projectId !== projectId || !Number.isSafeInteger(raw.baseVersion) || raw.baseVersion < 0 || !Number.isFinite(raw.updatedAt)) throw new Error('Invalid local draft');
  return { schemaVersion: 1, id: raw.id, projectId, updatedAt: raw.updatedAt, baseVersion: raw.baseVersion, base: normalizeTimelineDocument(raw.base, projectId), document: normalizeTimelineDocument(raw.document, projectId) };
}
/** One immutable owner ID per editor mount keeps different tabs' pending edits separate. */
export class TimelineDraftJournal {
  constructor(private storage: Storage, readonly projectId: string, readonly owner: string) {
    if (!/^[a-zA-Z0-9-]{1,80}$/.test(owner)) throw new Error('Invalid draft owner');
  }
  list(): { records: DraftRecord[]; unreadable: number } {
    const records: DraftRecord[] = []; let unreadable = 0;
    for (let i = 0; i < this.storage.length; i++) {
      const key = this.storage.key(i); if (!key?.startsWith(prefix(this.projectId))) continue;
      const serialized = this.storage.getItem(key); if (!serialized) continue;
      try {
        const draft = parse(serialized, this.projectId);
        if (key !== prefix(this.projectId) + draft.id) throw new Error('Draft key mismatch');
        records.push({ draft, serialized });
      } catch { unreadable++; }
    }
    return { records: records.sort((a, b) => b.draft.updatedAt - a.draft.updatedAt), unreadable };
  }
  write(base: TimelineDocument, document: TimelineDocument, baseVersion: number): DraftRecord {
    const draft: TimelineDraft = { schemaVersion: 1, id: this.owner, projectId: this.projectId, updatedAt: Date.now(), baseVersion, base, document };
    const serialized = JSON.stringify(draft), validated = parse(serialized, this.projectId);
    const key = prefix(this.projectId) + this.owner;
    const previous = this.storage.getItem(key);
    if (previous) {
      const saved = parse(previous, this.projectId);
      if (saved.baseVersion === baseVersion && JSON.stringify(saved.base) === JSON.stringify(validated.base) && JSON.stringify(saved.document) === JSON.stringify(validated.document)) return { draft: saved, serialized: previous };
    }
    if (!this.storage.getItem(key) && this.list().records.length >= 20) throw new Error('This project has 20 local drafts. Review and remove an old draft before backing up another.');
    this.storage.setItem(key, serialized); // Atomic Web Storage write: a quota failure leaves the previous copy intact.
    return { draft, serialized };
  }
  remove(record: DraftRecord): boolean {
    if (record.draft.projectId !== this.projectId) return false;
    const key = prefix(this.projectId) + record.draft.id;
    if (this.storage.getItem(key) !== record.serialized) return false;
    this.storage.removeItem(key); return true;
  }
}

export function mergeTimelineDraft(draft: TimelineDraft, remote: { document: TimelineDocument; version: number } | null) {
  if (!remote && draft.baseVersion !== 0) throw new Error('The saved timeline is missing. Download this draft before choosing another recovery path.');
  const baseline = remote?.document ?? draft.base;
  if (baseline.projectId !== draft.projectId) throw new Error('Draft belongs to another project');
  const merged = mergeTimelineDocuments({ base: draft.base, local: draft.document, remote: baseline });
  return { ...merged, baseline, version: remote?.version ?? 0 };
}
