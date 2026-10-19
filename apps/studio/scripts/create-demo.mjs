import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createDemoMedia } from './demo-media.mjs';

const base = process.env.VIRAL_HIT_URL || 'http://127.0.0.1:3808';
const headers = { 'x-viral-hit-workspace-request': '1' };
async function api(path, body) {
  const result = await fetch(`${base}${path}`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await result.json(); if (!result.ok) throw new Error(JSON.stringify(data)); return data;
}
await mkdir('data/demo', { recursive: true });
const file = resolve('data/demo/first-light.mp4'); createDemoMedia(file);
const project = await api('/api/app/projects', { name: 'First light · Viral Hit', workspaceMode: 'editor' });
const form = new FormData(); form.set('file', new Blob([await readFile(file)], { type: 'video/mp4' }), 'first-light.mp4');
const upload = await fetch(`${base}/api/app/projects/${project.id}/assets`, { method: 'POST', headers, body: form });
if (!upload.ok) throw new Error(`Import failed (${upload.status})`);
const { asset } = await upload.json();
await api(`/api/app/projects/${project.id}/commands`, { commandId: randomUUID(), command: { type: 'editor.apply', operations: [
  { type: 'add_clip', clipId: 'first-light', assetId: asset.id, sourceUrl: asset.publicUrl, name: 'First light · procedural motion', sourceType: 'video', sourceDuration: 3 },
  { type: 'split_clip', clipId: 'first-light', sourceTime: 1.5, rightClipId: 'second-light' },
  { type: 'upsert_caption', clipId: 'title-one', text: 'VIRAL HIT', startTime: 0, duration: 1.5 },
  { type: 'upsert_caption', clipId: 'title-two', text: 'MAKE YOUR NEXT TAKE.', startTime: 1.5, duration: 1.5 },
] } });
console.log(JSON.stringify({ projectId: project.id, editor: `${base}/editor/${project.id}`, media: 'Original procedural fixture; not an AI generation or performance comparison.' }, null, 2));
