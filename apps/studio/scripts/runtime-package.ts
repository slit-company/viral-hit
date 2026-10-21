import { resolve } from 'node:path';
import { runtimePackageRequest, MAX_RUNTIME_PACKAGE_BYTES } from '../src/core/runtime-packages/contract';
import { changeRuntimePackages } from '../src/core/runtime-packages/service.server';
import { buildRuntimePackage, readRuntimeJson, writeRuntimePackage } from '../src/core/runtime-packages/files.server';
import { readRuntimeRelease } from '../src/core/runtime-packages/storage.server';
const [action,target,output,digest]=process.argv.slice(2);
try {
  let result:unknown;
  if (action==='list') result=changeRuntimePackages({action});
  else if (action==='inspect'&&target) result=changeRuntimePackages({action,package:readRuntimeJson(resolve(target))});
  else if (action==='build'&&target&&output) result=writeRuntimePackage(resolve(output),buildRuntimePackage(readRuntimeJson(resolve(target))));
  else if (action==='export'&&target&&output) result=writeRuntimePackage(resolve(output),readRuntimeRelease(target,digest));
  else if ((action==='history'||action==='review-remove')&&target) result=changeRuntimePackages({action,id:target});
  else if (action==='change') {
    const chunks:Buffer[]=[];let size=0;
    for await(const chunk of process.stdin){const bytes=Buffer.from(chunk);size+=bytes.length;if(size>MAX_RUNTIME_PACKAGE_BYTES+2048)throw Error('Runtime request exceeds limit');chunks.push(bytes);}
    result=changeRuntimePackages(runtimePackageRequest.parse(JSON.parse(Buffer.concat(chunks).toString('utf8'))));
  } else throw Error('Usage: runtime-package list | inspect <file> | build <plan.json> <new-file> | export <id> <new-file> [digest] | history <id> | review-remove <id> | change < request.json');
  console.log(JSON.stringify(result,null,2));
} catch(error){console.error(error instanceof Error?error.message:'Runtime package command failed');process.exitCode=1;}
