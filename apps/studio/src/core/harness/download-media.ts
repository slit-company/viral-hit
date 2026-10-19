import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { open, unlink } from 'node:fs/promises';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import ipaddr from 'ipaddr.js';

export const MAX_REMOTE_MEDIA_BYTES = 512 * 1024 * 1024;
export function assertPublicAddress(address: string) {
  if (!ipaddr.isValid(address) || ipaddr.process(address).range() !== 'unicast') throw new Error('Media download requires a public network address');
}
export function mediaUrl(raw: string) {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) throw new Error('Media download requires HTTPS without credentials or a custom port');
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (ipaddr.isValid(hostname)) assertPublicAddress(hostname);
  return url;
}

/** HTTPS only, public DNS pinned to the socket, redirects revalidated, no auth/cookie forwarding. */
export async function downloadMedia(raw: string, destination: string, signal: AbortSignal, maxBytes = MAX_REMOTE_MEDIA_BYTES): Promise<void> {
  let ownsDestination = false;
  try {
    let url = mediaUrl(raw);
    for (let redirect = 0; redirect <= 4; redirect++) {
      signal.throwIfAborted();
      const addresses = await lookup(url.hostname.replace(/^\[|\]$/g, ''), { all: true });
      if (!addresses.length) throw new Error('Media host did not resolve');
      for (const address of addresses) assertPublicAddress(address.address);
      const selected = addresses[0];
      const response = await new Promise<import('node:http').IncomingMessage>((resolve, reject) => {
        const req = request(url, { method: 'GET', signal, agent: false, family: selected.family,
          lookup: (_hostname, options, callback) => {
            if (typeof options === 'object' && options.all) callback(null, [selected]);
            else callback(null, selected.address, selected.family);
          },
          headers: { Accept: 'image/*,video/*,audio/*,application/octet-stream', 'Accept-Encoding': 'identity', 'User-Agent': 'ViralHit/0.1' },
        }, resolve);
        req.on('error', reject); req.end();
      });
      if ([301, 302, 303, 307, 308].includes(response.statusCode ?? 0)) {
        const location = response.headers.location; response.destroy();
        if (!location || redirect === 4) throw new Error('Media redirect limit reached');
        url = mediaUrl(new URL(location, url).href); continue;
      }
      if (response.statusCode !== 200) { response.destroy(); throw new Error(`Media server returned ${response.statusCode ?? 'no status'}`); }
      const length = Number(response.headers['content-length']);
      if (Number.isFinite(length) && length > maxBytes) { response.destroy(); throw new Error('Media exceeds download limit'); }
      if (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity') { response.destroy(); throw new Error('Compressed media responses are unsupported'); }
      let size = 0;
      const bound = new Transform({ transform(chunk, _encoding, callback) {
        size += chunk.length;
        callback(size > maxBytes ? new Error('Media exceeds download limit') : null, chunk);
      } });
      let file;
      try { file = await open(destination, 'wx'); }
      catch (error) { response.destroy(); throw error; }
      ownsDestination = true;
      await pipeline(response, bound, file.createWriteStream(), { signal });
      if (!size) throw new Error('Media response was empty');
      return;
    }
  } catch (error) {
    if (ownsDestination) await unlink(destination).catch(() => undefined);
    // Avoid copying signed query parameters or request objects into logs.
    throw new Error(signal.aborted ? 'Media download timed out or was canceled' : error instanceof Error && /^(Media|Compressed|Invalid URL)/.test(error.message) ? error.message : 'Media download failed');
  }
}
