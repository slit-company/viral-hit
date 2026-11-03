/** Seconds in an MP4 or MOV file from its movie header (moov/mvhd), or null when it has none. */
export function mp4Seconds(bytes) {
  if (!(bytes instanceof Uint8Array)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const box = (start, end, type) => {
    for (let at = start; at + 8 <= end;) {
      let size = view.getUint32(at), header = 8;
      if (size === 1) { if (at + 16 > end) return null; size = Number(view.getBigUint64(at + 8)); header = 16; }
      else if (size === 0) size = end - at;
      if (size < header || at + size > end) return null;
      if (String.fromCharCode(...bytes.subarray(at + 4, at + 8)) === type) return { start: at + header, end: at + size };
      at += size;
    }
    return null;
  };
  const moov = box(0, bytes.length, 'moov'), header = moov && box(moov.start, moov.end, 'mvhd');
  if (!header || header.end - header.start < 32) return null;
  const long = bytes[header.start] === 1;
  const scale = view.getUint32(header.start + (long ? 20 : 12));
  const length = long ? Number(view.getBigUint64(header.start + 24)) : view.getUint32(header.start + 16);
  return scale > 0 && length > 0 ? length / scale : null;
}
