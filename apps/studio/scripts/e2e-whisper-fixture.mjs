// Protocol-only recognizer for reproducible browser/source tests. Never used by production startup.
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { chmod, readFile, writeFile, copyFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { whisperDescriptor } from '../../../extensions/whisper/src/descriptor.mjs';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export async function prepareWhisperFixture(directory, adapters, recipes) {
  const entry = 'whisper-fixture-adapter.mjs', target = join(adapters, entry);
  await build({ entryPoints: [resolve('../../extensions/whisper/src/adapter.mjs')], outfile: target, bundle: true, platform: 'node', format: 'esm', target: 'node24' });
  const descriptor = whisperDescriptor(entry, hash(await readFile(target)));
  await writeFile(join(adapters, 'whisper-fixture.json'), JSON.stringify(descriptor));
  const cli = join(directory, 'whisper-protocol-fixture'), model = join(directory, 'whisper-model-fixture');
  const script = '#!' + process.execPath + '\n' + `const fs=require('node:fs'),args=process.argv.slice(2);if(args[0]==='--version'){process.stdout.write('whisper.cpp version: fixture');}else{fs.writeFileSync(args[args.indexOf('-of')+1]+'.json',JSON.stringify({model:{type:'protocol-fixture'},result:{language:'en'},transcription:[{offsets:{from:0,to:800},text:'Fixture speech'},{offsets:{from:1100,to:1800},text:'Editable captions'}]}));}`;
  await writeFile(cli, script); await chmod(cli, 0o700); await writeFile(model, 'protocol-fixture-model');
  for (const name of ['local-video-captions', 'local-audio-captions']) await copyFile(resolve('../../extensions/whisper/recipes', name + '.json'), join(recipes, name + '.json'));
  return { VIRAL_HIT_WHISPER_CLI: cli, VIRAL_HIT_WHISPER_CLI_SHA256: hash(script), VIRAL_HIT_WHISPER_MODEL: model, VIRAL_HIT_WHISPER_MODEL_SHA256: hash('protocol-fixture-model') };
}
