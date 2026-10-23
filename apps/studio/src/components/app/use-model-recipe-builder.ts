import { useEffect, useRef, useState } from 'react';
import { apiJsonPost } from '@/lib/api-client';
import type { ModelRecipeModel } from '@/core/harness/model-recipe-contract';
import type { RecipeInspection } from '@/core/harness/recipe-library-contract';

export const sourceKinds = ['image', 'video', 'audio'] as const;
export function useModelRecipeBuilder(onBuilt: (result: RecipeInspection) => void) {
  const [models, setModels] = useState<ModelRecipeModel[]>([]);
  const [modelId, setModelId] = useState('');
  const [counts, setCounts] = useState({ image: '0', video: '0', audio: '0' });
  const [outputIndex, setOutputIndex] = useState('0');
  const [includeMask, setIncludeMask] = useState(false);
  const [sourceRoles, setSourceRoles] = useState<Record<string, 'style' | 'subject' | 'pose'>>({});
  const [metadata, setMetadata] = useState({ id: '', title: '', version: '1.0.0', description: '', author: '', license: '', category: 'creation' });
  const [scope, setScope] = useState('general');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const epoch = useRef(0);
  async function work<T>(task: () => Promise<T>, accept: (result: T) => void) {
    const current = ++epoch.current; setBusy(true); setError('');
    try { const result = await task(); if (current === epoch.current) accept(result); }
    catch (cause) { if (current === epoch.current) setError(cause instanceof Error ? cause.message : 'Recipe authoring failed'); }
    finally { if (current === epoch.current) setBusy(false); }
  }
  function refresh() {
    return work(() => apiJsonPost<{ models: ModelRecipeModel[] }>('/api/app/recipes', { action: 'model_catalog' }), result => setModels(result.models));
  }
  useEffect(() => { void refresh(); return () => { epoch.current++; }; }, []);
  const model = models.find(item => item.id === modelId);
  function choose(id: string) {
    const next = models.find(item => item.id === id);
    setModelId(id); setOutputIndex('0'); setError(''); setIncludeMask(false); setSourceRoles({});
    if (next) setCounts({ image: String(next.references.image.min), video: String(next.references.video.min), audio: String(next.references.audio.min) });
  }
  const total = sourceKinds.reduce((sum, kind) => sum + Number(counts[kind]), 0);
  const validCounts = model && sourceKinds.every(kind => counts[kind] !== '' && Number.isInteger(Number(counts[kind])) && Number(counts[kind]) >= model.references[kind].min && Number(counts[kind]) <= Math.min(20, model.references[kind].max));
  const ready = Boolean(model && validCounts && total <= 20 && (model.kind !== 'analysis' || total > 0) && outputIndex !== '' && Number.isInteger(Number(outputIndex)) && Number(outputIndex) >= 0 && Number(outputIndex) <= 7 && Object.values(metadata).every(value => value.trim()));
  function build() {
    if (!model || !ready) return;
    return work(() => apiJsonPost<RecipeInspection>('/api/app/recipes', { action: 'build_model', expectedModelDigest: model.digest,
      definition: { schemaVersion: 1, ...metadata, tags: [scope, model.kind], modelId, referenceCounts: { image: Number(counts.image), video: Number(counts.video), audio: Number(counts.audio) }, outputIndex: Number(outputIndex), mask: includeMask, sourceRoles: Object.fromEntries(Object.entries(sourceRoles).filter(([slot]) => { const [kind, index] = slot.split('-'); return Number(index) <= Number(counts[kind as 'image' | 'video']); })) } }), onBuilt);
  }
  return { models, model, modelId, counts, outputIndex, includeMask, setIncludeMask, sourceRoles, setSourceRoles, metadata, scope, busy, error, ready, total, refresh, choose, setCounts, setOutputIndex, setMetadata, setScope, build };
}
