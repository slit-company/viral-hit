import { send } from './http.mjs';
// Converts between project references, data URIs and downloaded result bytes.
const OUTPUT = ['image/png', 'image/jpeg', 'image/webp', 'video/mp4', 'video/webm', 'audio/wav', 'audio/mpeg', 'audio/ogg', 'audio/mp4', 'audio/aac'];
const ALIASES = { 'image/jpg': 'image/jpeg', 'audio/mp3': 'audio/mpeg', 'audio/x-wav': 'audio/wav', 'audio/wave': 'audio/wav', 'audio/x-m4a': 'audio/mp4', 'video/quicktime': 'video/mp4' };
const BY_EXTENSION = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', mp4: 'video/mp4', webm: 'video/webm', wav: 'audio/wav', mp3: 'audio/mpeg', ogg: 'audio/ogg', m4a: 'audio/mp4', aac: 'audio/aac' };
const LIMITS = { image: 50 * 1048576, video: 512 * 1048576, audio: 128 * 1048576 };

export function outputMime(type, url = '', kind) {
  const normalized = ALIASES[type] ?? type;
  if (OUTPUT.includes(normalized) && (!kind || normalized.startsWith(kind + '/'))) return normalized;
  const extension = /\.([a-z0-9]{2,4})(?:$|[?#])/i.exec(new URL(url, 'https://x.invalid').pathname)?.[1]?.toLowerCase();
  const guessed = BY_EXTENSION[extension];
  if (guessed && (!kind || guessed.startsWith(kind + '/'))) return guessed;
  if (kind === 'image' && (!type || type === 'application/octet-stream')) return 'image/png';
  if (kind === 'video' && (!type || type === 'application/octet-stream')) return 'video/mp4';
  if (kind === 'audio' && (!type || type === 'application/octet-stream')) return 'audio/mpeg';
  throw Error('Result has an unsupported media type: ' + (type || 'unknown'));
}

/** Downloads a provider result so it is stored in the project before the provider link expires. */
export async function downloadResult(provider, url, kind, { signal, headers } = {}) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw Error(provider + ' returned an unsupported result URL');
  const { bytes, type } = await send(provider, parsed.href, { headers, signal, timeout: 300_000, maxBytes: LIMITS[kind] });
  if (!bytes.length) throw Error(provider + ' returned an empty result');
  return { data: bytes, mimeType: outputMime(type, parsed.href, kind) };
}

export function fromBase64(value, mimeType, kind) {
  if (typeof value !== 'string' || !value) throw Error('Result contains no media data');
  const data = new Uint8Array(Buffer.from(value, 'base64'));
  if (!data.length || data.length > LIMITS[kind]) throw Error('Result media is empty or too large');
  return { data, mimeType: outputMime(mimeType, '', kind) };
}

/** Reads one admitted project reference through the runtime's verified reader. */
export async function readReference(readMedia, reference) {
  if (typeof readMedia !== 'function') throw Error('Use an imported project asset as the reference');
  const media = await readMedia(reference);
  if (!(media?.bytes instanceof Uint8Array) || !media.bytes.length) throw Error('Reference media is empty');
  return { bytes: media.bytes, mimeType: ALIASES[media.mimeType] ?? media.mimeType };
}

export const dataUri = ({ bytes, mimeType }) => 'data:' + mimeType + ';base64,' + Buffer.from(bytes).toString('base64');
export const extensionFor = mimeType => Object.entries(BY_EXTENSION).find(([, type]) => type === mimeType)?.[0] ?? (mimeType.split('/')[1] || 'bin');
