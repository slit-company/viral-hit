import {
  normalizeTimelineDocument,
  type TimelineDocument,
} from './timeline-document';

export type TimelineMergeConflict = { path: string };

const equal = (left: unknown, right: unknown) =>
  JSON.stringify(left) === JSON.stringify(right);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

const isIdArray = (value: unknown[]): value is Array<Record<string, unknown>> =>
  value.every(
    (item) => isRecord(item) && typeof item.id === 'string' && item.id.length > 0
  );

function mergeValue({
  base,
  local,
  remote,
  path,
  conflicts,
}: {
  base: unknown;
  local: unknown;
  remote: unknown;
  path: string;
  conflicts: TimelineMergeConflict[];
}): unknown {
  if (equal(local, remote)) return local;
  if (equal(local, base)) return remote;
  if (equal(remote, base)) return local;

  if (Array.isArray(base) && Array.isArray(local) && Array.isArray(remote)) {
    if (!isIdArray(base) || !isIdArray(local) || !isIdArray(remote)) {
      conflicts.push({ path });
      return local;
    }
    const baseMap = new Map(base.map((item) => [item.id as string, item]));
    const localMap = new Map(local.map((item) => [item.id as string, item]));
    const remoteMap = new Map(remote.map((item) => [item.id as string, item]));
    const ids = Array.from(
      new Set([
        ...remote.map((item) => item.id as string),
        ...local.map((item) => item.id as string),
        ...base.map((item) => item.id as string),
      ])
    );
    const merged: unknown[] = [];
    for (const id of ids) {
      const baseItem = baseMap.get(id);
      const localItem = localMap.get(id);
      const remoteItem = remoteMap.get(id);
      if (!localItem && !remoteItem) continue;
      if (!baseItem) {
        if (localItem && remoteItem && !equal(localItem, remoteItem)) {
          conflicts.push({ path: `${path}[${id}]` });
        }
        merged.push(localItem ?? remoteItem);
        continue;
      }
      if (!localItem) {
        if (!equal(remoteItem, baseItem)) {
          conflicts.push({ path: `${path}[${id}]` });
          merged.push(remoteItem);
        }
        continue;
      }
      if (!remoteItem) {
        if (!equal(localItem, baseItem)) {
          conflicts.push({ path: `${path}[${id}]` });
          merged.push(localItem);
        }
        continue;
      }
      merged.push(
        mergeValue({
          base: baseItem,
          local: localItem,
          remote: remoteItem,
          path: `${path}[${id}]`,
          conflicts,
        })
      );
    }
    if (path.endsWith('.motion.keyframes')) {
      const frames = merged as Array<Record<string, unknown>>;
      frames.sort((a, b) => Number(a.time) - Number(b.time));
      if (frames.some((frame, index) => index > 0 && frame.time === frames[index - 1].time)) {
        conflicts.push({ path });
        return local;
      }
    }
    return merged;
  }

  if (isRecord(base) && isRecord(local) && isRecord(remote)) {
    const merged: Record<string, unknown> = {};
    const keys = new Set([
      ...Object.keys(base),
      ...Object.keys(local),
      ...Object.keys(remote),
    ]);
    for (const key of keys) {
      if (key === 'updatedAt' || key === 'duration') continue;
      merged[key] = mergeValue({
        base: base[key],
        local: local[key],
        remote: remote[key],
        path: `${path}.${key}`,
        conflicts,
      });
    }
    if ('updatedAt' in local) merged.updatedAt = local.updatedAt;
    if ('duration' in local) merged.duration = local.duration;
    return merged;
  }

  conflicts.push({ path });
  return local;
}

export function mergeTimelineDocuments({
  base,
  local,
  remote,
}: {
  base: TimelineDocument;
  local: TimelineDocument;
  remote: TimelineDocument;
}) {
  const conflicts: TimelineMergeConflict[] = [];
  const merged = mergeValue({
    // Renders are derived artifacts, not competing user edits. Their source
    // must still match the merged document before retaining either receipt.
    base: { ...base, lastRenderAssetId: null, lastRenderUrl: null },
    local: { ...local, lastRenderAssetId: null, lastRenderUrl: null },
    remote: { ...remote, lastRenderAssetId: null, lastRenderUrl: null },
    path: 'timeline',
    conflicts,
  });
  const document = normalizeTimelineDocument(merged, local.projectId);
  const source = ({ updatedAt: _time, lastRenderAssetId: _asset, lastRenderUrl: _url, ...rest }: TimelineDocument) => rest;
  const matching = equal(source(document), source(normalizeTimelineDocument(remote, remote.projectId))) ? remote
    : equal(source(document), source(normalizeTimelineDocument(local, local.projectId))) ? local : null;
  return {
    document: { ...document, lastRenderAssetId: matching?.lastRenderAssetId ?? null, lastRenderUrl: matching?.lastRenderUrl ?? null },
    conflicts,
  };
}
