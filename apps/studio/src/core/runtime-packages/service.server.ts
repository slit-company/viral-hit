import { runtimePackageRequest, type RuntimePackageRequest } from './contract';
import { validateRuntimePackage, operatorRuntimeEntries, runtimeConflicts } from './validation.server';
import { commitRuntimePackage, readRuntimeCatalog, readRuntimeRelease, runtimeDigest, runtimeEntryId, runtimeHistory, runtimeSummary, RuntimePackageConflictError } from './storage.server';
import { managedRuntimeSnapshot, runtimeRestartRequired } from './snapshot.server';

const restart = 'Restart the studio, MCP and workers together to activate managed runtime changes. Existing jobs keep their original runtime identity; restore that release/configuration to recover them.';
export function inspectRuntimePackage(raw: unknown) {
  managedRuntimeSnapshot();
  const pkg = validateRuntimePackage(raw), catalog = readRuntimeCatalog(), operator = operatorRuntimeEntries();
  const current = catalog.packages.find(item=>item.id===pkg.id) ?? null;
  const others = catalog.packages.filter(item=>item.id!==pkg.id).flatMap(item=>item.entries);
  const blocking = runtimeConflicts([...operator,...others,...pkg.entries]);
  const currentEntries = current?.entries ?? [], keys = [...new Set([...currentEntries,...pkg.entries].map(entry=>entry.kind+':'+runtimeEntryId(entry)))];
  return { package:pkg, digest:runtimeDigest(pkg), stateDigest:runtimeDigest({ managed:catalog.stateDigest, operator:operator.map(entry=>runtimeDigest(entry)) }), catalogDigest:catalog.stateDigest, current,
    changes:keys.map(key=>{const before=currentEntries.find(entry=>entry.kind+':'+runtimeEntryId(entry)===key)??null, after=pkg.entries.find(entry=>entry.kind+':'+runtimeEntryId(entry)===key)??null;
      return { key, currentDigest:before?runtimeDigest(before):null, incomingDigest:after?runtimeDigest(after):null, change:!before?'add':!after?'remove':runtimeDigest(before)===runtimeDigest(after)?'same':'replace' };}),
    blocking, restart, trust:'Modules run with host filesystem, environment and network access. Inspection validates data, not code safety or behavior. No code executes during inspection or installation.' };
}
export function reviewRuntimeRemoval(id:string) {
  const catalog=readRuntimeCatalog(), current=catalog.packages.find(pkg=>pkg.id===id);
  if (!current) throw new RuntimePackageConflictError('Runtime package is no longer active');
  return { current,catalogDigest:catalog.stateDigest,stateDigest:catalog.stateDigest,restart };
}
export function changeRuntimePackages(raw: RuntimePackageRequest) {
  const request=runtimePackageRequest.parse(raw);
  managedRuntimeSnapshot();
  if (request.action==='list') {
    const desired=readRuntimeCatalog(), loaded=managedRuntimeSnapshot();
    return { installed:desired.packages.map(runtimeSummary), removed:desired.heads.filter(row=>row.removed).map(row=>runtimeSummary(readRuntimeRelease(row.id,row.digest))), loaded:loaded.packages.map(runtimeSummary), restartRequired:runtimeRestartRequired(desired), restart };
  }
  if (request.action==='inspect') return inspectRuntimePackage(request.package);
  if (request.action==='history') return runtimeHistory(request.id);
  if (request.action==='export') return readRuntimeRelease(request.id,request.digest);
  if (request.action==='review-remove') return reviewRuntimeRemoval(request.id);
  if (request.action==='remove') {
    const review=reviewRuntimeRemoval(request.id);
    if (review.stateDigest!==request.expectedStateDigest) throw new RuntimePackageConflictError('Runtime packages or operator configuration changed after review');
    commitRuntimePackage(request.id,review.catalogDigest,null);
    return { removed:true,id:request.id,restartRequired:runtimeRestartRequired(),restart };
  }
  const review=inspectRuntimePackage(request.package);
  if (review.digest!==request.expectedDigest || review.stateDigest!==request.expectedStateDigest) throw new RuntimePackageConflictError('Runtime package or operator configuration changed after review');
  if (review.blocking.length) throw new RuntimePackageConflictError(review.blocking.join('; '));
  commitRuntimePackage(review.package.id,review.catalogDigest,review.package);
  return { installed:runtimeSummary(review.package),restartRequired:runtimeRestartRequired(),restart };
}
export type RuntimePackageInspection = ReturnType<typeof inspectRuntimePackage>;
