import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {z} from 'zod';
import {runtimePackageSchema} from './contract';
import {validateRuntimePackage} from './validation.server';
test('published runtime package schema matches the author contract and bounds entry counts and source bytes',()=>{
  const published=JSON.parse(readFileSync('../../docs/schemas/runtime-package.schema.json','utf8'));
  assert.deepEqual(published,JSON.parse(JSON.stringify(z.toJSONSchema(runtimePackageSchema,{io:'input'}))));
  const manifest=JSON.parse(readFileSync('../../examples/adapters/tone/tone.json','utf8')),source=readFileSync('../../examples/adapters/tone/tone.mjs','utf8');
  const pkg={schemaVersion:1,kind:'viral-hit-runtime-package',id:'bounded-kit',version:'1.0.0',title:'Bounded kit',description:'Independent package',scope:'general',author:'QA',license:'MIT',entries:[{kind:'adapter',manifest,source}]};
  assert.equal(validateRuntimePackage(pkg).entries.length,1);
  assert.throws(()=>validateRuntimePackage({...pkg,entries:Array.from({length:17},()=>pkg.entries[0])}));
  assert.throws(()=>validateRuntimePackage({...pkg,entries:[{...pkg.entries[0],source:'x'.repeat(2_000_001)}]}),/2 MB/);
});
