/** Errors never contain provider bodies, signed URLs, tokens or raw network messages. */
export class InstagramTransportError extends Error {
  constructor(readonly outcome: 'unavailable' | 'unknown') { super('Instagram request could not be verified'); }
}

export async function instagramJson(response: Response, signal: AbortSignal): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new InstagramTransportError('unknown');
  const chunks: Uint8Array[] = []; let size = 0;
  const abort = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const { value, done } = await reader.read(); if (done) break;
      size += value.length;
      if (size > 64 * 1024) throw new InstagramTransportError('unknown');
      chunks.push(value);
    }
    signal.throwIfAborted();
    if (!response.ok) throw new InstagramTransportError('unknown');
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    try { return JSON.parse(new TextDecoder().decode(bytes)); }
    catch { throw new InstagramTransportError('unknown'); }
  } finally { signal.removeEventListener('abort', abort); await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}
