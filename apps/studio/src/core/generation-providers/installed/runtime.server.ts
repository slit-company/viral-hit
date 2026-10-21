import { validateInstalledAudioInput } from './audio-input';
import { resolveModelOptions } from '../model-controls';
import { createProviderMediaContext } from '../local-media.server';
import { validateInstalledAnalysisInput } from './analysis-input';
import { pinProviderTask, providerRuntimeDigest, unpinProviderTask } from './task-pin.server';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BaseAdapter, type EffectRecord, type GenerationResult } from '@/core/adapters/base-adapter';
import { getViralHitDataRoot } from '@/config/data-root';
import { MAX_LOCAL_IMAGE_ASSET_BYTES, MAX_LOCAL_VIDEO_ASSET_BYTES, MAX_LOCAL_AUDIO_ASSET_BYTES } from '@/core/effects/output-storage';
import { providerResultSchema, type ProviderManifest, type ProviderModel } from './manifest';

const SCHEME = 'viral-hit-provider:';
const EXTENSIONS: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'video/mp4': 'mp4', 'video/webm': 'webm', 'audio/wav': 'wav', 'audio/mpeg': 'mp3', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/aac': 'aac' };
const MIME_TYPES = Object.fromEntries(Object.entries(EXTENSIONS).map(([mimeType, extension]) => [extension, mimeType]));
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

// A native import, so neither the build nor the dev server's module runner tries to resolve operator code.
const nativeImport = new Function('url', 'return import(url)') as (url: string) => Promise<Partial<ProviderModule>>;

type ProviderModule = { createGeneration: (request: unknown) => Promise<unknown>; checkStatus?: (request: unknown) => Promise<unknown> };

/** The request a provider module receives: clean field names, never internal Viral Hit fields. */
export function providerInput(input: unknown) {
  const value = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const images = Array.isArray(value.image_urls) ? value.image_urls.filter((url): url is string => typeof url === 'string' && url.length > 0) : [];
  return {
    prompt: typeof value.prompt === 'string' ? value.prompt : '',
    ...(typeof value.aspect_ratio === 'string' ? { aspectRatio: value.aspect_ratio } : {}),
    ...(typeof value.wmDuration === 'string' ? { duration: value.wmDuration } : {}),
    ...(typeof value.seed === 'number' ? { seed: value.seed } : {}),
    imageUrls: images,
    ...(Array.isArray(value.video_urls) ? { videoUrls: value.video_urls.filter(url => typeof url === 'string') } : {}),
    ...(Array.isArray(value.audio_urls) ? { audioUrls: value.audio_urls.filter(url => typeof url === 'string') } : {}),
    ...(typeof value.video_url === 'string' ? { videoUrl: value.video_url } : {}),
    ...(typeof value.analysis_depth === 'string' ? { analysisDepth: value.analysis_depth } : {}),
    ...(typeof value.max_output_tokens === 'number' ? { maxOutputTokens: value.max_output_tokens } : {}),
  };
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 400);

/** Loads one installed provider module on first use and turns its results into generation results. */
export class InstalledProviderRuntime {
  private module?: Promise<ProviderModule>;
  /** source is the module text read at install time; edits on disk take effect after a restart. */
  constructor(readonly manifest: ProviderManifest, private readonly source: string, private readonly managed = false) {}

  load() {
    this.module ??= nativeImport('data:text/javascript;base64,' + Buffer.from(this.source).toString('base64')).then((loaded) => {
      if (typeof loaded.createGeneration !== 'function') throw new Error('The provider module must export createGeneration');
      return loaded as ProviderModule;
    });
    return this.module;
  }

  /** createGeneration problems fail the generation; checkStatus errors are thrown so polling retries them. */
  async call(method: 'createGeneration' | 'checkStatus', effect: EffectRecord, request: Record<string, unknown>, projectId?: unknown): Promise<GenerationResult> {
    const { label } = this.manifest;
    const model = this.manifest.models.find(item => item.id === effect.linkName);
    if (!model) {
      if(method==='checkStatus') throw Error(label+' no longer offers this task model. Restore its original runtime.');
      return { status:'failed',error:label+' does not offer '+effect.linkName };
    }
    const runtime = this.managed ? providerRuntimeDigest(this.manifest,this.source) : undefined;
    if(runtime && method==='checkStatus') request={...request,taskId:unpinProviderTask(request.taskId,runtime,model.id)};
    const missing = this.manifest.environment.filter(name => !process.env[name]?.trim());
    if (missing.length) throw new Error('Provider configuration is missing: ' + missing.join(', '));
    let raw: unknown;
    let mediaContext: Awaited<ReturnType<typeof createProviderMediaContext>> | undefined;
    try {
      const signal = AbortSignal.timeout(method === 'createGeneration' ? 10 * 60_000 : 60_000);
      if (method === 'createGeneration' && this.manifest.referenceDelivery === 'project-media') {
        mediaContext = await createProviderMediaContext(projectId, request.input as Record<string, unknown>, signal);
      }
      const loaded = await this.load();
      if (method === 'checkStatus' && !loaded.checkStatus) return { status: 'failed', error: label + ' cannot report progress for unfinished work' };
      raw = await loaded[method]!({ model: { id: model.id, upstreamModelId: model.upstreamModelId ?? model.id, kind: model.kind }, ...request, signal, ...(mediaContext ? { media: mediaContext.media, readMedia: mediaContext.readMedia } : {}) });
    } catch (error) {
      if (method === 'checkStatus') throw error;
      return { status: 'failed', error: label + ': ' + message(error) };
    } finally { await mediaContext?.dispose(); }
    try { return await this.toResult(raw, model, runtime); }
    catch (error) { return { status: 'failed', error: label + ' returned an unusable result: ' + message(error) }; }
  }

  private async toResult(raw: unknown, model: ProviderModel, runtime?:string): Promise<GenerationResult> {
    const result = providerResultSchema.parse(raw);
    if (model.kind === 'analysis') {
      if (result.media?.length) throw new Error('Analysis models return text, not media');
      if (result.status === 'succeeded' && !result.text && !result.report) throw new Error('A succeeded analysis needs text or a structured report');
    } else if (result.text || result.report || (result.status === 'succeeded' && !result.media?.length)) throw new Error('Image/video/audio models return media, not analysis text');
    const urls: string[] = [];
    for (const item of result.media ?? []) {
      if ('url' in item) { this.checkMediaUrl(item.url); urls.push(item.url); continue; }
      if (!item.mimeType.startsWith(model.kind + '/')) throw new Error('A ' + model.kind + ' model returned ' + item.mimeType);
      urls.push(await this.storeBytes(item.data, item.mimeType));
    }
    return {
      status: result.status,
      output: { ...(result.taskId ? { taskId: runtime ? pinProviderTask(result.taskId,runtime,model.id) : result.taskId, ...(runtime ? {upstreamTaskId:result.taskId} : {}) } : {}), ...(urls.length ? { resultUrls: urls } : {}), ...(result.text || result.report ? { analysis_text: result.text ?? result.report!.summary } : {}), ...(result.report ? { analysis_report: result.report } : {}) },
      ...(result.error ? { error: result.error } : {}),
    };
  }

  /** Bytes a module returns are kept once by hash until the generation saves them as a project asset. */
  private async storeBytes(data: Uint8Array, mimeType: string) {
    const limit = mimeType.startsWith('video/') ? MAX_LOCAL_VIDEO_ASSET_BYTES : mimeType.startsWith('audio/') ? MAX_LOCAL_AUDIO_ASSET_BYTES : MAX_LOCAL_IMAGE_ASSET_BYTES;
    if (data.byteLength === 0 || data.byteLength > limit) throw new Error('Returned media is empty or too large');
    const name = createHash('sha256').update(data).digest('hex') + '.' + EXTENSIONS[mimeType];
    const directory = join(getViralHitDataRoot(), 'provider-media', this.manifest.id);
    const path = join(directory, name);
    if (!(await stat(path).catch(() => null))?.isFile()) {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const temporary = path + '.' + randomUUID() + '.tmp';
      try { await writeFile(temporary, data, { flag: 'wx', mode: 0o600 }); await rename(temporary, path); }
      catch (error) { await rm(temporary, { force: true }); throw error; }
    }
    return SCHEME + '//' + this.manifest.id + '/' + name;
  }

  private checkMediaUrl(url: string) {
    const parsed = new URL(url);
    const secure = parsed.protocol === 'https:' || (parsed.protocol === 'http:' && LOOPBACK.has(parsed.hostname));
    if (!secure || !this.manifest.mediaHosts.includes(parsed.host)) throw new Error('Result URL host ' + parsed.host + ' is not listed in mediaHosts');
  }

  readOutputMedia = async (url: string, signal: AbortSignal): Promise<Response> => {
    if (url.startsWith(SCHEME)) {
      const parsed = new URL(url), name = parsed.pathname.slice(1);
      const extension = /^[a-f0-9]{64}\.([a-z0-9]+)$/.exec(name)?.[1];
      if (parsed.host !== this.manifest.id || !extension || !MIME_TYPES[extension]) throw new Error('Unknown provider media reference');
      const bytes = await readFile(join(getViralHitDataRoot(), 'provider-media', this.manifest.id, name));
      return new Response(bytes, { headers: { 'content-type': MIME_TYPES[extension], 'content-length': String(bytes.byteLength) } });
    }
    this.checkMediaUrl(url);
    return fetch(url, { signal, redirect: 'error' });
  };
}

export class InstalledProviderAdapter extends BaseAdapter {
  constructor(effect: EffectRecord, private readonly runtime: InstalledProviderRuntime) { super(effect); }
  createGeneration(input: unknown) {
    const model = this.runtime.manifest.models.find(item => item.id === this.effect.linkName);
    if (this.effect.type === 4) validateInstalledAudioInput(input, model?.referenceInputs);
    if (this.effect.type === 3) validateInstalledAnalysisInput(input, model?.analysisInputs);
    const options = resolveModelOptions(model?.controls, (input as Record<string, unknown> | null)?.provider_options);
    return this.runtime.call('createGeneration', this.effect, { input: { ...providerInput(input), ...(model?.controls ? { options } : {}) } }, (input as Record<string, unknown> | null)?._referenceProjectId);
  }
  checkStatus(taskId: string) { return this.runtime.call('checkStatus', this.effect, { taskId }); }
}
