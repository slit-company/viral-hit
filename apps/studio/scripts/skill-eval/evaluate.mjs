// Usage: pnpm skill:eval [skill-id ...] — writes research/evidence/skills/skill-eval-report.json.
import { startMcp } from './mcp-client.mjs';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
const studio = process.cwd(), only = process.argv.slice(2);
const ffmpeg = process.env.VIRAL_HIT_FFMPEG || 'ffmpeg', ffprobe = process.env.VIRAL_HIT_FFPROBE || 'ffprobe';
const m = await startMcp(studio);
const fixtures = join(m.data, 'fixtures'); mkdirSync(fixtures);
const png = (name, color) => { const p = join(fixtures, name); execFileSync(ffmpeg, ['-v','error','-y','-f','lavfi','-i','color=c=' + color + ':s=512x512','-frames:v','1',p]); return p; };
const cuts = () => { const p = join(fixtures, 'reference.mp4'); execFileSync(ffmpeg, ['-v','error','-y','-f','lavfi','-i','color=c=red:s=360x640:r=24:d=1.5','-f','lavfi','-i','color=c=blue:s=360x640:r=24:d=1.5','-f','lavfi','-i','color=c=green:s=360x640:r=24:d=1.5','-f','lavfi','-i','sine=f=440:d=4.5','-filter_complex','[0][1][2]concat=n=3:v=1:a=0[v]','-map','[v]','-map','3:a','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-shortest',p]); return p; };
const probe = path => JSON.parse(execFileSync(ffprobe, ['-v','error','-show_entries','format=duration:stream=codec_type,width,height','-of','json',path]).toString());
const results = [];
async function scenario(skill, fn) {
  if (only.length && !only.includes(skill)) return;
  const steps = [];
  const step = async (label, run) => { try { const value = await run(); steps.push({ label, ok: true }); return value; } catch (error) { steps.push({ label, ok: false, error: String(error.message || error).slice(0, 300) }); throw error; } };
  try { await fn(step); } catch {}
  const ok = steps.length > 0 && steps.every(s => s.ok);
  results.push({ skill, ok, steps });
  console.log((ok ? 'PASS ' : 'FAIL ') + skill); for (const s of steps) console.log('  ' + (s.ok ? '✓' : '✗') + ' ' + s.label + (s.error ? ' — ' + s.error : ''));
}
const skillText = async id => { const s = await m.call('viral_hit_skill_get', { skillId: id }); const text = s.skill?.instructions ?? s.instructions ?? JSON.stringify(s); if (!text || text.length < 200) throw Error('skill text missing'); return s; };
const project = async name => (await m.call('viral_hit_project_create', { name })).project?.id ?? (await m.call('viral_hit_project_list', {})).projects?.[0]?.id;
const generate = async (projectId, modelId, mode, prompt, extra = {}) => {
  const prepared = await m.call('viral_hit_asset_generation', { request: { action: 'prepare', generation: { version: 2, projectId, mode, modelId, prompt, references: extra.references ?? [], parameters: extra.parameters ?? {} } } });
  const submitted = await m.call('viral_hit_asset_generation', { request: { action: 'submit', generation: prepared.generation, generationIntentToken: prepared.generationIntentToken, expectedDigest: prepared.digest } });
  return { prepared, submitted };
};
const history = async projectId => (await m.call('viral_hit_generation_history', { projectId, limit: 50 }));
globalThis.ctx = { m, png, cuts, probe, scenario, skillText, project, generate, history, fixtures };
const { scenarios } = await import(process.env.SCENARIOS || new URL('./scenarios.mjs', import.meta.url).href);
await scenarios(globalThis.ctx);
const reportDir = process.env.REPORT_DIR || join(studio, '../../research/evidence/skills'); mkdirSync(reportDir, { recursive: true });
writeFileSync(join(reportDir, 'skill-eval-report.json'), JSON.stringify({ ranAt: new Date().toISOString(), results }, null, 2));
m.close(); process.exit(results.every(r => r.ok) ? 0 : 1);

