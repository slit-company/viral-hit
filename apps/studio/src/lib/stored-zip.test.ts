import { test } from 'node:test';
import assert from 'node:assert/strict';
import { storedZip } from './stored-zip';
import JSZip from 'jszip';

test('an independent ZIP reader validates CRCs and round-trips Unicode and multi-chunk binary entries', async () => {
  const bytes = Uint8Array.from({ length: 150000 }, (_, i) => i % 251);
  const zip = await storedZip([{ name: '01-한국어.png', blob: new Blob([bytes]) }, { name: '02-empty.wav', blob: new Blob([]) }]);
  const decoded = await JSZip.loadAsync(await zip.arrayBuffer(), { checkCRC32: true });
  assert.deepEqual(await decoded.file('01-한국어.png')!.async('uint8array'), bytes);
  assert.equal((await decoded.file('02-empty.wav')!.async('uint8array')).length, 0);
});

test('ZIP media bytes, UTF-8 names, STORE records and standard CRC vector agree in both directories', async () => {
  const fixtures = [{ name: '01-한국어.png', blob: new Blob(['123456789']) }, { name: '02-empty.wav', blob: new Blob([]) }];
  const data = new Uint8Array(await (await storedZip(fixtures)).arrayBuffer()), view = new DataView(data.buffer);
  const end = data.length - 22; assert.equal(view.getUint32(end, true), 0x06054b50); assert.equal(view.getUint16(end + 10, true), 2);
  let central = view.getUint32(end + 16, true), position = 0;
  for (const [i, fixture] of fixtures.entries()) {
    assert.equal(view.getUint32(central, true), 0x02014b50);
    assert.equal(view.getUint32(central + 42, true), position);
    assert.equal(view.getUint32(position, true), 0x04034b50);
    assert.equal(view.getUint16(position + 6, true), 0x800); assert.equal(view.getUint16(position + 8, true), 0);
    const size = view.getUint32(position + 22, true), length = view.getUint16(position + 26, true);
    assert.equal(view.getUint32(position + 14, true), i ? 0 : 0xcbf43926);
    assert.equal(view.getUint32(central + 16, true), i ? 0 : 0xcbf43926);
    assert.equal(new TextDecoder().decode(data.slice(position + 30, position + 30 + length)), fixture.name);
    assert.deepEqual(data.slice(position + 30 + length, position + 30 + length + size), new Uint8Array(await fixture.blob.arrayBuffer()));
    position += 30 + length + size; central += 46 + length;
  }
  assert.equal(central, end);
  assert.equal((await storedZip([])).size, 22);
});

test('ZIP rejects ambiguous names and ZIP32 overflow before reading media', async () => {
  for (const name of ['../escape', '/absolute', 'a/../b', 'bad\\name', 'a\0b']) await assert.rejects(storedZip([{ name, blob: new Blob([]) }]));
  await assert.rejects(storedZip([{ name: 'same', blob: new Blob([]) }, { name: 'same', blob: new Blob([]) }]), /Duplicate/);
  const huge = { size: 0xffffffff, stream() { throw Error('must not read'); } } as unknown as Blob;
  await assert.rejects(storedZip([{ name: 'large', blob: huge }]), /too large/);
});
