import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
const require = createRequire(new URL('../../apps/studio/package.json', import.meta.url));
const { chromium } = require('@playwright/test');
const B = process.env.VIRAL_HIT_URL ?? 'http://127.0.0.1:3000', OUT = process.env.VIRAL_HIT_DEMO_DIR ?? 'demo-recording';
mkdirSync(OUT + '/raw', { recursive: true });
const CAP = (t) => { let d = document.getElementById('vh-cap'); if (!d) { d = document.createElement('div'); d.id = 'vh-cap'; d.style.cssText = 'position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:2147483647;background:#161616;color:#fff;font:600 21px/1.3 Pretendard,system-ui;padding:13px 24px;border-radius:999px;box-shadow:0 8px 30px rgba(0,0,0,.22);pointer-events:none;white-space:nowrap;transition:opacity .2s'; document.body.appendChild(d); } d.innerHTML = t; d.style.opacity = t ? '1' : '0'; };
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: OUT + '/raw', size: { width: 1440, height: 900 } }, acceptDownloads: true });
await ctx.addCookies([{ name: 'PARAGLIDE_LOCALE', value: 'en', url: B }]);
const p = await ctx.newPage();
const t0 = Date.now(), now = () => (Date.now() - t0) / 1000, marks = { waits: [], events: [] };
const log = (name) => { marks.events.push({ name, t: now() }); console.log(now().toFixed(1), name); };
const cap = async (t) => { await p.evaluate(CAP, t).catch(() => {}); };
const pause = (s) => p.waitForTimeout(s * 1000);
const go = async (path) => { await p.goto(B + path, { waitUntil: 'networkidle' }); };
let projectId = '';
const succeeded = async () => (await (await p.request.get(B + '/api/app/projects/' + projectId + '/generations')).json()).items.filter(i => i.status === 'succeeded').length;
const failed = async () => (await (await p.request.get(B + '/api/app/projects/' + projectId + '/generations')).json()).items.filter(i => i.status === 'failed');
async function waitFor(count, label) {
  const start = now(); log('wait:' + label);
  for (let i = 0; i < 150; i++) {
    if (await succeeded() >= count) break;
    const bad = await failed(); if (bad.length) throw Error(label + ' failed: ' + JSON.stringify(bad[0].error ?? bad[0]).slice(0, 300));
    await pause(2);
  }
  await pause(2.5); marks.waits.push({ label, start: start + 1.6, end: now() - 1.2 }); log('done:' + label);
}
try {
  await go('/'); await pause(1.2);
  await cap('Viral Hit &nbsp;·&nbsp; <span style="color:#caff51">Higgsfield + CapCut</span>, open source'); await pause(2.4);
  await cap('Find it. Remake it. Ship it. Measure it.');
  await p.locator('textarea').first().type('A courier in a lime rain jacket sprints through a neon alley at night, cinematic', { delay: 22 });
  await pause(0.6); await p.getByRole('button', { name: 'Create', exact: true }).click();
  await p.waitForURL(/\/studio\/[0-9a-f-]{36}/, { timeout: 30000 });
  projectId = p.url().match(/studio\/([0-9a-f-]{36})/)[1]; writeFileSync(OUT + '/project.txt', projectId); log('project ' + projectId);
  await p.waitForLoadState('networkidle'); await pause(4);
  await cap('One project. Pick any provider and model');
  await p.getByLabel('API provider', { exact: true }).selectOption('higgsfield'); await pause(0.8);
  await p.getByLabel('Task model', { exact: true }).selectOption('higgsfield-soul-2'); await pause(0.8);
  await p.getByLabel('Aspect ratio', { exact: true }).selectOption('16:9').catch(() => {}); await pause(0.8);
  await cap('Create &nbsp;→&nbsp; real Higgsfield Soul 2 call');
  await p.getByRole('button', { name: 'Create', exact: true }).click();
  await waitFor(1, 'higgsfield');
  await cap('Every result opens with next steps'); await pause(0.6);
  await p.locator('article').first().getByRole('button', { name: 'Open preview', exact: true }).click(); await pause(2.2);
  await cap('Targeted revision: change one thing, keep the rest');
  await p.getByRole('button', { name: 'Edit this image', exact: true }).click(); await pause(1.8);
  await p.getByLabel('API provider', { exact: true }).selectOption('xai'); await pause(0.8);
  await p.getByLabel('Task model', { exact: true }).selectOption('xai-grok-imagine-image-2').catch(() => {}); await pause(0.6);
  await p.getByLabel('Scene description', { exact: true }).type('Make only the rain jacket hot pink. Keep the face, pose, alley and lighting.', { delay: 16 });
  await pause(0.6); await cap('Edit with xAI Grok Imagine — same project, different provider');
  await p.getByRole('button', { name: 'Create', exact: true }).click();
  await waitFor(2, 'xai-edit');
  await cap('Voice-over from ElevenLabs');
  await p.getByRole('button', { name: 'Voice', exact: true }).first().click(); await pause(2);
  await p.getByLabel('Audio prompt', { exact: true }).type('Find it. Remake it. Ship it.', { delay: 30 }); await pause(0.6);
  await p.getByRole('button', { name: 'Generate audio', exact: true }).click();
  await waitFor(3, 'voice');
  await cap('Then cut it like CapCut'); await pause(1.4);
} catch (error) { console.error('FAILED', error.message); await p.screenshot({ path: OUT + '/fail.png' }); }
finally {
  writeFileSync(OUT + '/marks.json', JSON.stringify(marks, null, 2));
  const video = p.video(); await ctx.close(); await b.close();
  console.log('video', await video.path());
}



