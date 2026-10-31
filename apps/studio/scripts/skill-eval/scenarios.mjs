// Walks each official skill's workflow through the same MCP tools an agent uses. Local example
// providers and connectors only: no paid model call and no external publication.
const assetOf = item => item.resultUrl.split('/').pop();
const latest = async (history, id, n, modelId) => { const h = await history(id); const items = (h.items ?? h).filter(i => !modelId || i.modelId === modelId).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))); const pick = items.slice(-n); if (pick.length !== n || pick.some(i => i.status !== 'succeeded')) throw Error(JSON.stringify(items.map(i => [i.modelId, i.status, i.error]))); return pick; };
const renderAndProbe = async (m, probe, id) => { const r = await m.call('viral_hit_editor_render', { projectId: id }); const asset = r.asset ?? r; const path = asset.filePath ?? asset.localPath; const info = path ? probe(path) : null; return { asset, info }; };
async function basics({ m, scenario, skillText, project, generate, history }) {
  await scenario('batch-variations', async step => {
    await step('read skill', () => skillText('batch-variations'));
    const id = await step('create project', () => project('Batch QA'));
    const models = await step('discover image models', async () => { const r = await m.call('viral_hit_generation_models', { kind: 'image' }); const list = r.models ?? r; if (!list.some(x => x.id === 'procedural-gradient')) throw Error('no local model'); return list; });
    const prepared = await step('prepare three variations before submitting any', async () => Promise.all(['dawn', 'dusk', 'night'].map(t => m.call('viral_hit_asset_generation', { request: { action: 'prepare', generation: { version: 2, projectId: id, mode: 'image', modelId: 'procedural-gradient', prompt: t + ' gradient', references: [], parameters: { aspect_ratio: '1:1' } } } }))));
    await step('submit every ready item', async () => { for (const p of prepared) { await m.call('viral_hit_asset_generation', { request: { action: 'submit', generation: p.generation, generationIntentToken: p.generationIntentToken, expectedDigest: p.digest } }); await new Promise(r => setTimeout(r, 600)); } });
    await step('account for every item in history', async () => { const h = await history(id); const items = h.items ?? h; const done = items.filter(i => i.status === 'succeeded'); if (done.length !== 3) throw Error('expected 3 succeeded, got ' + JSON.stringify(items.map(i => i.status))); });
    await step('consumed token cannot submit again', async () => { try { await m.call('viral_hit_asset_generation', { request: { action: 'submit', generation: prepared[0].generation, generationIntentToken: prepared[0].generationIntentToken, expectedDigest: prepared[0].digest } }); } catch { return; } throw Error('duplicate submission accepted'); });
  });
  await scenario('video-model-routing', async step => {
    await step('read skill', () => skillText('video-model-routing'));
    const id = await step('create project', () => project('Routing QA'));
    const video = await step('list video models with declared inputs', async () => { const r = await m.call('viral_hit_generation_models', { kind: 'video' }); const list = r.models ?? r; if (!list.length) throw Error('no video models'); return list; });
    await step('read one model descriptor', async () => { const d = await m.call('viral_hit_generation_model_get', { modelId: video[0].id }); if (!JSON.stringify(d).includes(video[0].id)) throw Error('descriptor missing'); });
    const run = await step('prepare and submit once', () => generate(id, 'procedural-gradient-queued', 'image', 'queued frame', { parameters: { aspect_ratio: '1:1' } }));
    await step('inspect the same intent instead of resubmitting', async () => { const r = await m.call('viral_hit_asset_generation', { request: { action: 'inspect', projectId: id, generationIntentToken: run.prepared.generationIntentToken } }); if (!JSON.stringify(r).match(/processing|succeeded|pending/)) throw Error(JSON.stringify(r).slice(0, 200)); });
    await step('queued job finishes through status polling', async () => { for (let i = 0; i < 40; i++) { const h = await history(id); const it = (h.items ?? h)[0]; if (it?.status === 'succeeded') return; if (it?.status === 'failed') throw Error(it.error); await new Promise(r => setTimeout(r, 1000)); } throw Error('still processing'); });
  });
}

async function workflows({ m, png, cuts, probe, scenario, skillText, project, generate, history }) {
  await scenario('character-intro', async step => {
    await step('read skill and the consistent-characters skill it builds on', async () => { await skillText('character-intro'); await skillText('consistent-characters'); });
    const id = await step('create project', () => project('Intro QA'));
    const ch = await step('create the character from the supplied image with written rules', () => m.call('viral_hit_character', { request: { action: 'create', profile: { name: 'Pip', kind: 'mascot', description: 'Round lime mascot', invariants: ['two antennae', 'lime body'], forbidden: ['extra limbs'] }, references: [{ path: png('pip.png', 'lime'), role: 'canonical' }] } }));
    const used = await step('use it in the project (canonical asset + brief)', () => m.call('viral_hit_character', { request: { action: 'use', id: ch.id, projectId: id } }));
    const canonical = used.assets.find(a => a.role === 'canonical').assetId;
    const style = await step('import a style reference', async () => (await m.call('viral_hit_asset_import', { projectId: id, filePath: png('style.png', 'pink') })).asset?.id ?? (await m.call('viral_hit_asset_list', { projectId: id })).find(a => a.filename?.includes('style')).id);
    await step('generate five keyframes with the canonical image attached', async () => { for (const beat of ['waves', 'jumps', 'spins', 'bows', 'smiles']) { await generate(id, 'subject-on-style', 'image', used.brief + ' Beat: Pip ' + beat + '.', { references: [{ assetId: canonical, role: 'subject' }, { assetId: style, role: 'style' }] }); await new Promise(r => setTimeout(r, 600)); } });
    const frames = await step('all five keyframes succeeded', () => latest(history, id, 5, 'subject-on-style'));
    await step('generate a five-second voice track', () => generate(id, 'procedural-sound', 'audio', 'intro line placeholder tone', { parameters: { provider_options: { frequency: 440, seconds: 5, wave: 'sine' } } }));
    const voice = await step('voice succeeded', async () => (await latest(history, id, 1, 'procedural-sound'))[0]);
    await step('place five one-second beats, the voice and a caption', async () => { const r = await m.call('viral_hit_editor_edit', { projectId: id, operations: [
      ...frames.map((f, i) => ({ type: 'add_clip', clipId: 'beat-' + i, assetId: assetOf(f), name: 'Beat ' + (i + 1), sourceType: 'image', sourceDuration: 1 })),
      { type: 'add_clip', clipId: 'voice', assetId: assetOf(voice), name: 'Voice', sourceType: 'audio', sourceDuration: 5, startTime: 0, audioRole: 'voice' },
      { type: 'upsert_caption', clipId: 'line', text: 'Meet Pip.', startTime: 0, duration: 5 } ] }); if (!r.ok) throw Error(JSON.stringify(r).slice(0, 300)); });
    await step('export is exactly five seconds with audio', async () => { const { info } = await renderAndProbe(m, probe, id); if (!info) throw Error('render returned no local file'); const d = Number(info.format.duration); if (Math.abs(d - 5) > 0.08) throw Error('duration ' + d); if (!info.streams.some(s => s.codec_type === 'audio')) throw Error('no audio'); });
  });
  await scenario('voiced-short', async step => {
    await step('read skill', () => skillText('voiced-short'));
    const id = await step('create project', () => project('Voiced QA'));
    const footage = await step('import footage', async () => { const r = await m.call('viral_hit_asset_import', { projectId: id, filePath: cuts() }); return r.asset?.id ?? r.id; });
    await step('generate narration', () => generate(id, 'procedural-sound', 'audio', 'narration placeholder tone', { parameters: { provider_options: { frequency: 220, seconds: 4.5, wave: 'triangle' } } }));
    const voice = await step('narration succeeded', async () => (await latest(history, id, 1, 'procedural-sound'))[0]);
    await step('place footage and narration', () => m.call('viral_hit_editor_edit', { projectId: id, operations: [
      { type: 'add_clip', clipId: 'footage', assetId: footage, name: 'Footage', sourceType: 'video', sourceDuration: 4.5 },
      { type: 'add_clip', clipId: 'voice', assetId: assetOf(voice), name: 'Narration', sourceType: 'audio', sourceDuration: 4.5, startTime: 0, audioRole: 'voice' } ] }));
    await step('import timed captions from SRT', () => m.call('viral_hit_editor_import_srt', { projectId: id, srt: '1\n00:00:00,000 --> 00:00:02,000\nFind it.\n\n2\n00:00:02,000 --> 00:00:04,400\nRemake it.\n' }));
    await step('timeline holds video, voice and two captions', async () => { const t = await m.call('viral_hit_editor_get', { projectId: id }); const doc = t.timeline?.document ?? t.document ?? t; const clips = doc.tracks.flatMap(tr => tr.clips.map(c => c.sourceType)); if (clips.filter(c => c === 'caption').length !== 2 || !clips.includes('audio') || !clips.includes('video')) throw Error(JSON.stringify(clips)); });
    await step('export has picture and sound', async () => { const { info } = await renderAndProbe(m, probe, id); if (!info) throw Error('render returned no local file'); if (!['video', 'audio'].every(k => info.streams.some(s => s.codec_type === k))) throw Error(JSON.stringify(info.streams)); });
  });
  await scenario('publish-and-measure', async step => {
    await step('read skill', () => skillText('publish-and-measure'));
    const id = await step('create project with a rendered version', async () => { const pid = await project('Publish QA'); const r = await m.call('viral_hit_asset_import', { projectId: pid, filePath: cuts() }); await m.call('viral_hit_editor_edit', { projectId: pid, operations: [{ type: 'add_clip', clipId: 'v', assetId: r.asset?.id ?? r.id, name: 'Cut', sourceType: 'video', sourceDuration: 4.5 }] }); return pid; });
    const rendered = await step('render the version to publish', async () => (await m.call('viral_hit_editor_render', { projectId: id })).asset);
    const dest = await step('list connected destinations', async () => { const l = await m.call('viral_hit_publication_list', { projectId: id }); const c = (l.installedConnectors?.connectors ?? []).find(x => x.id === 'ext.local-archive'); if (!c) throw Error('no installed connector: ' + JSON.stringify(l).slice(0, 200)); return c; });
    const draft = await step('save the post as a draft (nothing is sent)', () => m.call('viral_hit_publication_change', { projectId: id, request: { action: 'create', requestKey: 'pub-1', connector: 'ext.local-archive', accountId: 'archive', assetIds: [rendered.id], metadata: { title: 'Hook A', collection: 'campaign' } } }));
    const pub = draft.publication ?? draft;
    await step('approve the exact draft', () => m.call('viral_hit_publication_change', { projectId: id, request: { action: 'approve', publicationId: pub.id, expectedRevision: pub.revision, expectedDigest: pub.digest ?? pub.approvalDigest, confirmed: true } }));
    await step('wait for the delivery receipt', async () => { for (let i = 0; i < 60; i++) { const l = await m.call('viral_hit_publication_list', { projectId: id }); const p = (l.publications ?? []).find(x => x.id === pub.id); if (p?.state === 'delivered' || p?.status === 'delivered' || p?.state === 'published') return; if (/failed|stopped/.test(p?.state ?? '')) throw Error(p.state); await new Promise(r => setTimeout(r, 1000)); } throw Error('not delivered'); });
    await step('record a reading, keeping a missing measure missing', () => m.call('viral_hit_performance_change', { projectId: id, request: { action: 'record', publicationId: pub.id, requestKey: 'reading-1', metrics: { views: 120 }, observedAt: new Date().toISOString(), note: '24 h' } }));
    await step('read it back', async () => { const r = await m.call('viral_hit_performance_read', { projectId: id, publicationId: pub.id }); const s = JSON.stringify(r); if (!s.includes('120')) throw Error(s.slice(0, 300)); if (/"downloads":0/.test(s)) throw Error('missing measure stored as zero'); });
  });

  await scenario('hit-remake', async step => {
    await step('read skill and the skills it builds on', async () => { await skillText('hit-remake'); await skillText('storyboard'); await skillText('video-model-routing'); });
    const id = await step('create project', () => project('Remake QA'));
    const src = await step('import the reference', async () => { const r = await m.call('viral_hit_asset_import', { projectId: id, filePath: cuts() }); return r.asset?.id ?? r.id; });
    const lib = await m.call('viral_hit_recipes_list', {}); const rec = (lib.recipes ?? lib).find(r => r.id === 'detect-video-scenes');
    const waitRun = async runId => { for (let i = 0; i < 90; i++) { const l = await m.call('viral_hit_runs_list', { projectId: id }); const r = (l.runs ?? l).find(x => x.id === runId); const states = (r?.jobs ?? []).map(j => j.state); if (states.length && states.every(s => s === 'succeeded')) return r; if (states.some(s => /failed|cancel/.test(s))) throw Error(JSON.stringify(states)); await new Promise(r => setTimeout(r, 1000)); } throw Error('run timeout'); };
    await step('split it at visual cuts', async () => { const r = await m.call('viral_hit_runs_change', { projectId: id, request: { action: 'recipe', recipeId: 'detect-video-scenes', requestKey: 'scenes-1', values: { source: src }, expectedRecipeDigest: rec.digest } }); await waitRun(r.runId); });
    const source = await step('find the completed scene result', async () => { const s = await m.call('viral_hit_storyboard', { projectId: id, request: { action: 'reference-sources' } }); const x = s.sources.find(v => v.kind === 'scenes'); if (!x || x.count !== 3) throw Error(JSON.stringify(s).slice(0, 300)); return x; });
    const proposal = await step('prepare an unsaved shot plan from the scenes', () => m.call('viral_hit_storyboard', { projectId: id, request: { action: 'prepare-reference', scenes: { runId: source.runId, jobId: source.jobId, outputSha256: source.outputSha256 }, firstScene: 0, lastScene: 2, title: 'Remake QA', intent: 'Keep the three-beat rhythm, change the subject to a gradient mascot.', scope: 'general' } }));
    const plan = proposal.plan ?? proposal;
    if (plan.shots?.length !== 3) throw Error('expected three shots');
    plan.shots = plan.shots.map((s, i) => ({ ...s, direction: 'Beat ' + (i + 1) + ': same timing and framing, new subject.', preserve: ['timing', 'framing'], change: ['subject'], avoid: ['source text'] }));
    let board = await step('save the reviewed plan', () => m.call('viral_hit_storyboard', { projectId: id, request: { action: 'save', id: 'remake-qa', expectedRevision: 0, plan } }));
    await step('generate one remake still per shot', async () => { for (const s of plan.shots) { await generate(id, 'procedural-gradient', 'image', s.direction, { parameters: { aspect_ratio: '9:16' } }); await new Promise(r => setTimeout(r, 600)); } });
    const stills = await step('stills succeeded', async () => { const h = await history(id); const items = (h.items ?? h).filter(i => i.modelId === 'procedural-gradient').sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))); if (items.length !== 3 || items.some(i => i.status !== 'succeeded')) throw Error('stills'); const assets = await m.call('viral_hit_asset_list', { projectId: id }); return items.map(i => assets.find(a => a.id === i.resultUrl.split('/').pop())); });
    await step('accept one take per shot with review notes', async () => { for (const [i, shot] of plan.shots.entries()) { board = await m.call('viral_hit_storyboard', { projectId: id, request: { action: 'accept', id: 'remake-qa', expectedRevision: board.revision ?? board.storyboard?.revision, shotId: shot.id, source: { kind: 'asset', assetId: stills[i].id, sha256: stills[i].sha256 }, notes: 'Matches beat ' + (i + 1) + ' timing; subject replaced.' } }); } });
    const assembled = await step('assemble accepted shots into an editable sequence', async () => { const r = await m.call('viral_hit_storyboard', { projectId: id, request: { action: 'assemble', id: 'remake-qa', expectedRevision: board.revision ?? board.storyboard?.revision, requestId: crypto.randomUUID() } }); const runId = r.runId ?? r.action?.runId ?? r.actions?.at(-1)?.runId; if (!runId) throw Error(JSON.stringify(r).slice(0, 300)); return { run: await waitRun(runId), runId }; });
    await step('attach it to the current timeline', async () => { const job = assembled.run.jobs.at(-1); const t = await m.call('viral_hit_editor_get', { projectId: id }); const r = await m.call('viral_hit_runs_change', { projectId: id, request: { action: 'attach', runId: assembled.runId, jobId: job.id, expectedRevision: t?.version ?? t?.revision ?? 0 } }); if (r.ok === false) throw Error(JSON.stringify(r).slice(0, 300)); });
    await step('export keeps the three-beat length', async () => { const r = await m.call('viral_hit_editor_render', { projectId: id }); const a = r.asset; const path = a.filePath ?? a.localPath; const info = path ? probe(path) : null; const d = info ? Number(info.format.duration) : (a.durationMs ?? 0) / 1000; if (Math.abs(d - 4.5) > 0.2) throw Error('duration ' + d); });
  });
}

export async function scenarios(context) {
  await basics(context);
  await workflows(context);
}
