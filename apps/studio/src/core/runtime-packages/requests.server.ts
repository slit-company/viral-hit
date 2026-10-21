import { runtimePackageRequest } from './contract';
import { changeRuntimePackages, inspectRuntimePackage } from './service.server';
import { fetchRuntimePackage } from './source.server';

/** Network acquisition precedes the existing synchronous lifecycle boundary. */
export async function requestRuntimePackages(raw: unknown, signal?: AbortSignal) {
  const request = runtimePackageRequest.parse(raw);
  signal?.throwIfAborted();
  if (request.action !== 'fetch') return changeRuntimePackages(request);
  const downloaded = await fetchRuntimePackage(request, signal);
  signal?.throwIfAborted();
  return { ...inspectRuntimePackage(downloaded.package), download: downloaded.download };
}
