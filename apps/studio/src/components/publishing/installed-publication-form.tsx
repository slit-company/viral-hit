import { useRef, useState } from 'react';
import { TextField } from '@seed-design/react';
import { Action } from '@/components/base/action';
import { NativeSelect } from '@/components/ui/native-select';
import type { InstalledConnectorDescriptor } from '@/core/publishing/installed/contract';
import type { PublicationView } from '@/core/publishing/public-view';
import { publicationRequest, type PublicationRequest } from '@/core/publishing/requests';
import type { JsonValue } from '@/lib/canonical-json';
import type { PublicationVideo } from './use-publications';
import { InstalledMetadataFields, metadataDefaults, needsJsonEditor } from './installed-metadata-fields';

export function InstalledPublicationForm({ connector, assets, pending, editing, change, done }: {
  connector: InstalledConnectorDescriptor; assets: PublicationVideo[]; pending: boolean; editing?: PublicationView;
  change: (request: PublicationRequest) => Promise<boolean>; done: () => void;
}) {
  const [accountId, setAccountId] = useState(editing?.accountId ?? ''), [assetIds, setAssetIds] = useState(editing?.external?.assets.map(asset => asset.assetId) ?? []);
  const original = editing?.external?.metadata;
  const [values, setValues] = useState<Record<string, JsonValue>>(original && typeof original === 'object' && !Array.isArray(original) ? original : metadataDefaults(connector.metadataSchema));
  const [raw, setRaw] = useState(needsJsonEditor(connector.metadataSchema)), [text, setText] = useState(JSON.stringify(values, null, 2)), [error, setError] = useState('');
  const identity = useRef({ body: '', key: '' });
  const eligible = assets.filter(asset => connector.mediaTypes.includes(asset.mimeType as never));
  async function submit() {
    setError('');
    let metadata = values;
    if (raw) { try { metadata = JSON.parse(text); } catch { setError('Metadata must be valid JSON.'); return; } }
    const fields = { connector: connector.id, accountId, assetIds, metadata }, body = JSON.stringify(fields);
    if (identity.current.body !== body) identity.current = { body, key: crypto.randomUUID() };
    const parsed = publicationRequest.safeParse(editing ? { ...fields, action: 'revise', publicationId: editing.id, expectedRevision: editing.revision } : { ...fields, action: 'create', requestKey: identity.current.key });
    if (!parsed.success) { setError('Choose a destination, media and valid metadata.'); return; }
    if (await change(parsed.data)) done();
  }
  return <section aria-label="Installed destination draft" className="space-y-4 rounded-2xl border border-[var(--vh-border)] bg-[var(--vh-surface)] p-5 sm:p-6">
    <div><h2 className="text-lg font-semibold">{editing ? 'Edit draft' : 'Prepare a delivery'}</h2><p className="mt-2 text-sm leading-6 text-[var(--vh-text-2)]">{connector.description}</p><p className="mt-2 text-xs text-[var(--vh-text-2)]">{connector.scope === 'general' ? 'General' : 'For a specific job'} · {connector.label}</p></div>
    {!connector.configured && <p role="status" className="rounded-xl bg-[var(--vh-control)] p-3 text-sm">This destination needs setup before approval: {connector.missingEnvironment.join(', ')}.</p>}
    <form className="space-y-4" onSubmit={event => { event.preventDefault(); void submit(); }}>
      <fieldset disabled={pending} className="space-y-4">
        <label className="block space-y-2 text-sm font-medium"><span>Configured destination</span><NativeSelect aria-label="Configured destination" value={accountId} onChange={event => setAccountId(event.target.value)} required><option value="">Choose a destination</option>{connector.destinations.map(destination => <option key={destination.id} value={destination.id}>{destination.label}</option>)}</NativeSelect></label>
        <fieldset className="space-y-2"><legend className="mb-2 text-sm font-medium">Project media · up to {connector.maxAssets} files</legend>
          {!eligible.length && <p className="text-sm text-[var(--vh-text-2)]">Add project assets supported by this destination: {connector.mediaTypes.join(', ')}.</p>}
          <div className="max-h-56 space-y-2 overflow-y-auto">{eligible.map(asset => <label key={asset.id} className="flex items-start gap-2 rounded-lg border border-[var(--vh-border)] p-3 text-sm"><input className="mt-1" type="checkbox" checked={assetIds.includes(asset.id)} disabled={!assetIds.includes(asset.id) && assetIds.length >= connector.maxAssets} onChange={event => setAssetIds(ids => event.target.checked ? [...ids, asset.id] : ids.filter(id => id !== asset.id))} /><span className="min-w-0 break-words">{asset.filename ?? asset.id}<span className="block text-xs text-[var(--vh-text-2)]">{asset.mimeType}{assetIds.includes(asset.id) ? ' · #' + (assetIds.indexOf(asset.id) + 1) : ''}</span></span></label>)}</div>
          {assetIds.length > 1 && <p className="text-xs text-[var(--vh-text-2)]">Files are delivered in selection order. Deselect and select a file to move it to the end.</p>}
        </fieldset>
        {raw ? <TextField.Root className="vh-field"><TextField.Textarea aria-label="Metadata JSON" value={text} onChange={event => setText(event.target.value)} className="min-h-48 font-mono text-xs" /></TextField.Root> : <InstalledMetadataFields schema={connector.metadataSchema} values={values} onChange={(id, value) => setValues(current => ({ ...current, [id]: value }))} />}
        <details className="rounded-xl border border-[var(--vh-border)] p-3 text-xs"><summary className="cursor-pointer font-medium">Metadata format</summary><pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap break-words">{JSON.stringify(connector.metadataSchema, null, 2)}</pre>{!raw && <Action className="vh-secondary mt-3 text-xs" onClick={() => { setText(JSON.stringify(values, null, 2)); setRaw(true); }}>Edit as JSON</Action>}</details>
      </fieldset>
      {error && <p role="alert" className="text-sm text-red-800">{error}</p>}
      <p className="text-xs leading-5 text-[var(--vh-text-2)]">Save a draft, review its retained media and destination, then approve this exact revision.</p>
      <div className="flex gap-2"><Action type="submit" className="vh-primary" disabled={pending || !assetIds.length || !accountId}>{pending ? 'Saving…' : editing ? 'Save new revision' : 'Save draft'}</Action>{editing && <Action disabled={pending} className="vh-secondary" onClick={done}>Cancel edit</Action>}</div>
    </form>
  </section>;
}
