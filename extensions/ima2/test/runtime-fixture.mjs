// Opt-in test server: the actual pinned ima2 application, with outbound AI calls replaced.
// Launched in an isolated child environment by verify-ima2.ts, never production.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { join, isAbsolute } from 'node:path';
import { createRequire } from 'node:module';

const root = process.argv[2];
if (!root || !isAbsolute(root) || process.env.VH_IMA2_TEST_FIXTURE !== '1' || !process.send) throw Error('Isolated IPC test process required');
assert.equal(JSON.parse(await readFile(join(root, 'package.json'))).version, '3.26.3');
const require = createRequire(join(root, 'package.json'));
const sharp = require('sharp');
const png = await sharp({ create: { width: 96, height: 64, channels: 4, background: '#ff5438' } }).png().toBuffer();
let paidCalls = 0, referencedCalls = 0;
globalThis.fetch = async (url, init) => {
  if (String(url) !== 'https://api.openai.com/v1/responses') throw Error('Fixture blocked unexpected outbound request');
  const body = JSON.parse(init.body);
  assert.equal(body.model, 'gpt-5.4');
  paidCalls++;
  if (JSON.stringify(body).includes('data:image/png;base64,')) referencedCalls++;
  const events = [
    { type: 'response.output_item.done', item: { type: 'image_generation_call', result: png.toString('base64'), revised_prompt: 'Fixture image' } },
    { type: 'response.completed', response: { usage: { total_tokens: 3 } } },
  ];
  return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'Content-Type': 'text/event-stream' } });
};
const load = file => import(pathToFileURL(join(root, file)).href);
const { config } = await load('config.js');
const { createTestRuntimeContext } = await load('lib/runtimeContext.js');
const { buildApp } = await load('server.js');
const { closeDb } = await load('lib/db.js');
const context = createTestRuntimeContext({ rootDir: root, packageVersion: '3.26.3', apiKey: 'test-only', hasApiKey: true,
  config: { ...config, server: { ...config.server, host: '127.0.0.1' }, log: { ...config.log, level: 'silent' } } });
const app = buildApp(context);
const server = await new Promise(resolve => { const server = app.listen(0, '127.0.0.1', () => resolve(server)); });
process.send({ url: `http://127.0.0.1:${server.address().port}` });
process.on('message', async message => {
  if (message === 'stats') process.send({ paidCalls, referencedCalls });
  if (message === 'stop') {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    app.locals.disposeLocalLanAccess?.(); closeDb(); process.exit(0);
  }
});
