import { requestRuntimePackages } from '@/core/runtime-packages/requests.server';
import { changeRuntimePackages } from '@/core/runtime-packages/service.server';
import { MAX_RUNTIME_PACKAGE_BYTES } from '@/core/runtime-packages/contract';
import { RuntimePackageConflictError } from '@/core/runtime-packages/storage.server';
import { validateTrustedWorkspaceJsonMutation } from '@/lib/trusted-local-request';
import { readRequestJsonWithLimit } from '@/lib/request-body-limit';
export function runtimePackagesGet() {return Response.json(changeRuntimePackages({action:'list'}),{headers:{'Cache-Control':'no-store'}});}
export async function runtimePackagesPost(request:Request) {
  const trust=validateTrustedWorkspaceJsonMutation(request);
  if(!trust.ok)return Response.json({error:trust.message},{status:trust.status});
  try{return Response.json(await requestRuntimePackages(await readRequestJsonWithLimit(request,MAX_RUNTIME_PACKAGE_BYTES+2048), request.signal),{headers:{'Cache-Control':'no-store'}});}
  catch(error){return Response.json({error:error instanceof Error?error.message.slice(0,1000):'Runtime package request failed'},{status:error instanceof RuntimePackageConflictError?409:400});}
}
