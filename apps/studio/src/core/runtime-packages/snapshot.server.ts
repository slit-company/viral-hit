import { getViralHitDataRoot } from '@/config/data-root';
import { readRuntimeCatalog, runtimeDigest } from './storage.server';
import type { RuntimeEntry } from './contract';

const snapshots = new Map<string, ReturnType<typeof readRuntimeCatalog>>();
/** Executable source is stable until all participating processes restart. Inspection never resets it. */
export function managedRuntimeSnapshot() {
  const root = getViralHitDataRoot();
  if (!snapshots.has(root)) snapshots.set(root, readRuntimeCatalog());
  return snapshots.get(root)!;
}
export function managedRuntimeEntries(kind: RuntimeEntry['kind']) { return managedRuntimeSnapshot().packages.flatMap(pkg => pkg.entries.filter(entry => entry.kind === kind)); }

export function runtimeRestartRequired(desired = readRuntimeCatalog()) {
  const active = (catalog:ReturnType<typeof readRuntimeCatalog>) => catalog.packages.map(pkg => [pkg.id,runtimeDigest(pkg)]);
  return runtimeDigest(active(desired)) !== runtimeDigest(active(managedRuntimeSnapshot()));
}
