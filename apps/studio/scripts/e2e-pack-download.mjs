// Test-only HTTPS transport fixture. Never loaded by production serve.mjs.
import https from 'node:https';
import dns from 'node:dns/promises';
import { syncBuiltinESMExports } from 'node:module';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createReadStream, statSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
if (!process.env.VIRAL_HIT_DATA_DIR?.includes('viral-hit-e2e-')) throw new Error('Pack fixture requires an isolated E2E workspace');
const host = 'public-packs.viralhit.test', nativeLookup = dns.lookup, nativeRequest = https.request;
dns.lookup = async (hostname, options) => hostname === host
  ? options?.all ? [{ address: '93.184.216.34', family: 4 }] : { address: '93.184.216.34', family: 4 }
  : nativeLookup(hostname, options);
https.request = (url, options, callback) => {
  if (url.hostname !== host) return nativeRequest(url, options, callback);
  const request = new EventEmitter();
  request.end = () => queueMicrotask(() => {
    const response = new PassThrough();
    response.statusCode = 200;
    if (url.pathname === '/private-redirect.tar') {
      response.statusCode = 302; response.headers = { location: 'https://127.0.0.1/private.tar' }; callback(response); response.end(); return;
    }
    if (url.pathname !== '/community.tar') { response.statusCode = 404; response.headers = {}; callback(response); response.end(); return; }
    const file = join(process.env.VIRAL_HIT_DATA_DIR, 'shared-creative-pack.tar');
    appendFileSync(join(process.env.VIRAL_HIT_DATA_DIR, 'pack-fetches.txt'), 'fetch\n');
    response.headers = { 'content-length': String(statSync(file).size), 'content-type': 'application/x-tar' };
    const input = createReadStream(file);
    const abort = () => { input.destroy(); response.destroy(new Error('Fixture download aborted')); };
    options.signal?.addEventListener('abort', abort, { once: true });
    response.once('close', () => { options.signal?.removeEventListener('abort', abort); input.destroy(); });
    callback(response); input.pipe(response);
  });
  return request;
};
syncBuiltinESMExports();
