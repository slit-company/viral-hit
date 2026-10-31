import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
const require = createRequire(new URL('../../apps/studio/package.json', import.meta.url));
const { chromium } = require('@playwright/test');
const B = process.env.VIRAL_HIT_URL ?? 'http://127.0.0.1:3000', OUT = process.env.VIRAL_HIT_DEMO_DIR ?? 'demo-recording';
const projectId = readFileSync(OUT + '/project.txt', 'utf8').trim();
mkdirSync(OUT + '/raw2', { recursive: true });
const CAP = (t) => { let d = document.getElementById('vh-cap'); if (!d) { d = document.createElement('div'); d.id = 'vh-cap'; d.style.cssText = 'position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:2147483647;background:#161616;color:#fff;font:600 21px/1.3 Pretendard,system-ui;padding:13px 24px;border-radius:999px;box-shadow:0 8px 30px rgba(0,0,0,.22);pointer-events:none;white-space:nowrap;transition:opacity .2s'; document.body.appendChild(d); } d.innerHTML = t; d.style.opacity = t ? '1' : '0'; };
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: OUT + '/raw2', size: { width: 1440, height: 900 } }, acceptDownloads: true });
await ctx.addCookies([{ name: 'PARAGLIDE_LOCALE', value: 'en', url: B }]);
const p = await ctx.newPage();
const t0 = Date.now(), now = () => (Date.now() - t0) / 1000, marks = { waits: [], events: [] };
const log = (name) => { marks.events.push({ name, t: now() }); console.log(now().toFixed(1), name); };
const cap = async (t) => { await p.evaluate(CAP, t).catch(() => {}); };
const pause = (s) => p.waitForTimeout(s * 1000);
const go = async (path) => { await p.goto(B + path, { waitUntil: 'networkidle' }); };
try {
  await go('/editor/' + projectId);
  const adds = p.getByRole('button', { name: /^Add .+ to the timeline$/ });
  await adds.first().waitFor({ timeout: 30000 }); await pause(1); log('editor');
  await cap('Drop results from the media bin onto a real multitrack timeline'); await pause(1);
  for (const name of [/^Add a-courier/, /^Add make-only/, /^Add find-it/]) { await p.getByRole('button', { name }).first().click(); await pause(1.4); }
  await pause(1);
  await p.getByRole('button', { name: 'Play selection', exact: true }).click({ timeout: 3000 }).catch(() => {}); await pause(3.2);
  await p.getByRole('button', { name: /^Pause$/ }).click({ timeout: 1500 }).catch(() => {});
  await p.getByRole('button', { name: 'Export MP4', exact: true }).click();
  const hold = p.getByRole('button', { name: 'Hold the last image until the audio ends', exact: true });
  if (await hold.waitFor({ timeout: 6000 }).then(() => true, () => false)) { await cap('Voice runs longer than the shots? One click holds the last image'); await pause(2.2); await hold.click(); await pause(1.6); }
  await cap('Export MP4');
  const download = p.waitForEvent('download', { timeout: 240000 });
  await p.getByRole('button', { name: 'Export MP4', exact: true }).click();
  const exportStart = now(); log('export');
  const file = await download; await file.saveAs(OUT + '/export.mp4');
  marks.waits.push({ label: 'export', start: exportStart + 2, end: now() - 0.8 }); log('exported');
  await pause(2);
  await go('/publish/' + projectId); await cap('Ship it to YouTube and Instagram, then track how it performs'); await pause(3.4);
  await go('/connections'); await pause(1);
  await p.getByRole('heading', { name: 'Model APIs' }).scrollIntoViewIfNeeded().catch(() => {});
  await cap('Nine model APIs on one page. Keys stay encrypted on your server'); await pause(3.4);
  await go('/canvas/' + projectId); await cap('Canvas for ideas and versions'); await pause(2.6);
  await go('/ko/studio/' + projectId); await pause(2.5); await cap('English and 한국어'); await pause(2.6);
  await ctx.addCookies([{ name: 'PARAGLIDE_LOCALE', value: 'en', url: B }]);
  await go('/'); await cap('github.com/slit-company/viral-hit &nbsp;·&nbsp; Apache-2.0'); await pause(3.5);
} catch (error) { console.error('FAILED', error.message.slice(0, 400)); await p.screenshot({ path: OUT + '/fail2.png' }); }
finally {
  writeFileSync(OUT + '/marks2.json', JSON.stringify(marks, null, 2));
  const video = p.video(); await ctx.close(); await b.close();
  console.log('video', await video.path());
}







