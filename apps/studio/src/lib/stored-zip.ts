/** ZIP32/STORE writer for already-compressed media downloads. No inflater or archive reader ships to the browser. */
const encoder = new TextEncoder();
const table = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
async function crc32(blob: Blob) {
  const reader = blob.stream().getReader();
  let crc = 0xffffffff;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      for (const byte of value) crc = table[(crc ^ byte) & 255] ^ (crc >>> 8);
    }
  } finally { reader.releaseLock(); }
  return (crc ^ 0xffffffff) >>> 0;
}
function header(size: number, signature: number) {
  const bytes = new Uint8Array(size), view = new DataView(bytes.buffer);
  view.setUint32(0, signature, true);
  return { bytes, view };
}
export async function storedZip(files: { name: string; blob: Blob }[]): Promise<Blob> {
  if (files.length > 65535) throw Error('Too many files for a ZIP32 archive');
  const names = new Set<string>();
  // Check the full ZIP32 layout before reading any bytes.
  const entries = files.map(file => {
    if (!file.name || /[\\\u0000]/.test(file.name) || file.name.startsWith('/') || file.name.split('/').some(part => part === '..' || part === '.')) throw Error('Invalid ZIP entry name');
    if (names.has(file.name)) throw Error('Duplicate ZIP entry name');
    names.add(file.name);
    const name = encoder.encode(file.name);
    if (name.length > 65535 || file.blob.size > 0xffffffff) throw Error('ZIP32 entry limit exceeded');
    return { ...file, encoded: name };
  });
  const localSize = entries.reduce((size, item) => size + 30 + item.encoded.length + item.blob.size, 0);
  const centralSize = entries.reduce((size, item) => size + 46 + item.encoded.length, 0);
  if (localSize + centralSize + 22 > 0xffffffff) throw Error('Download is too large for a ZIP32 archive');
  const parts: BlobPart[] = [], central: BlobPart[] = [];
  let offset = 0;
  for (const { encoded: name, blob } of entries) {
    const crc = await crc32(blob);
    const local = header(30, 0x04034b50), directory = header(46, 0x02014b50);
    local.view.setUint16(4, 20, true); local.view.setUint16(6, 0x0800, true);
    local.view.setUint16(12, 0x0021, true); // 1980-01-01; deterministic, no invented source timestamp.
    local.view.setUint32(14, crc, true);
    local.view.setUint32(18, blob.size, true); local.view.setUint32(22, blob.size, true);
    local.view.setUint16(26, name.length, true);
    directory.view.setUint16(4, 20, true); directory.view.setUint16(6, 20, true); directory.view.setUint16(8, 0x0800, true);
    directory.view.setUint16(14, 0x0021, true); directory.view.setUint32(16, crc, true);
    directory.view.setUint32(20, blob.size, true); directory.view.setUint32(24, blob.size, true);
    directory.view.setUint16(28, name.length, true); directory.view.setUint32(42, offset, true);
    parts.push(local.bytes, name, blob); central.push(directory.bytes, name);
    offset += local.bytes.length + name.length + blob.size;
  }
  const end = header(22, 0x06054b50);
  end.view.setUint16(8, entries.length, true); end.view.setUint16(10, entries.length, true);
  end.view.setUint32(12, centralSize, true); end.view.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end.bytes], { type: 'application/zip' });
}
