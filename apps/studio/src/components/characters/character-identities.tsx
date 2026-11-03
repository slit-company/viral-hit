import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw, Sparkles } from 'lucide-react';
import { m } from '@/paraglide/messages.js';
import { Action } from '@/components/base/action';
import { NativeSelect } from '@/components/ui/native-select';
import { Link } from '@/core/i18n/navigation';
import { apiJsonPost } from '@/lib/api-client';
import type { Character, ProviderIdentity } from '@/core/characters/contract';
import { cn } from '@/lib/utils';
import type { useCharacters } from './use-characters';

type Service = { providerId: string; label: string; family: string; name: string; versions: { value: string; label: string }[]; maxImages: number; connected: boolean };
const POLL_MS = 20_000;

function Status({ identity }: { identity: ProviderIdentity }) {
  const status = identity.status ?? 'ready';
  return <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', status === 'ready' ? 'bg-[var(--color-brand-lime-soft)] text-[var(--color-lime-text)]' : status === 'failed' ? 'bg-red-500/10 text-red-800' : 'bg-amber-100 text-amber-950')}
    title={identity.error}>{status === 'ready' ? m['ui.identity.ready']() : status === 'failed' ? m['ui.identity.failed']() : m['ui.identity.training']()}</span>;
}

/** Identities a service trained from this character's images, such as Soul IDs, and the way to train one. */
export function CharacterIdentities({ character, library }: { character: Character; library: ReturnType<typeof useCharacters> }) {
  const services = useQuery({ queryKey: ['identity-services'], queryFn: () => apiJsonPost<{ services: Service[] }>('/api/app/characters', { action: 'identity_services' }).then(result => result.services), staleTime: 60_000 });
  const options = (services.data ?? []).filter(service => service.connected).flatMap(service => service.versions.map(version => ({ service, version, value: service.providerId + '|' + version.value })));
  const [choice, setChoice] = useState(''), selected = options.find(option => option.value === choice) ?? options[0];
  const training = character.providerIdentities.filter(identity => identity.status === 'training' && identity.providerId);
  // While a service trains, ask it now and then; the character reloads only when the answer changes something.
  useEffect(() => {
    if (!training.length) return;
    const timer = window.setInterval(() => void Promise.all(training.map(identity => apiJsonPost<{ identity: ProviderIdentity }>('/api/app/characters', { action: 'check_identity', id: character.id, referenceId: identity.referenceId })
      .then(result => result.identity.status !== 'training')))
      .then(changed => { if (changed.some(Boolean)) void library.refresh(); }, () => undefined), POLL_MS);
    return () => window.clearInterval(timer);
  }, [character.id, training.map(identity => identity.referenceId).join()]);
  if (!character.providerIdentities.length && !services.data?.length) return null;
  return <section aria-label={m['ui.identity.title']()} className="space-y-3 rounded-xl border border-[var(--vh-border)] p-3">
    <div className="space-y-0.5"><p className="text-sm font-semibold">{m['ui.identity.title']()}</p><p className="text-xs leading-5 text-[var(--vh-text-2)]">{m['ui.identity.description']()}</p></div>
    {character.providerIdentities.length > 0 && <ul className="space-y-1.5">{character.providerIdentities.map(identity => <li key={identity.provider + identity.referenceId} className="flex flex-wrap items-center gap-2 text-xs">
      <span className="font-medium">{identity.label ?? identity.provider}</span>
      <code className="break-all rounded bg-[var(--vh-control)] px-1.5 py-0.5 text-[11px]">{identity.referenceId}</code>
      <Status identity={identity} />
      {identity.status === 'training' && identity.providerId && <Action type="button" disabled={library.busy} className="inline-flex items-center gap-1 text-[11px] text-[var(--vh-text-2)]"
        onClick={() => void library.change({ action: 'check_identity', id: character.id, referenceId: identity.referenceId })}><RefreshCw className="size-3" />{m['ui.identity.check']()}</Action>}
      {identity.status === 'failed' && identity.error && <span className="w-full text-[11px] text-red-800">{identity.error}</span>}
    </li>)}</ul>}
    {selected ? <div className="flex flex-wrap items-center gap-2">
      <NativeSelect aria-label={m['ui.identity.version']()} className="w-auto min-w-52" value={selected.value} onChange={event => setChoice(event.target.value)}>
        {options.map(option => <option key={option.value} value={option.value}>{option.service.name} · {option.version.label} ({option.service.label})</option>)}
      </NativeSelect>
      <Action type="button" disabled={library.busy} className="vh-secondary inline-flex h-10 items-center gap-1.5 px-3 text-xs"
        onClick={() => void library.change({ action: 'train_identity', id: character.id, expectedVersion: character.version, providerId: selected.service.providerId, version: selected.version.value })}>
        <Sparkles className="size-3.5" />{m['ui.identity.train']({ name: selected.service.name })}</Action>
      <p className="w-full text-[11px] leading-5 text-[var(--vh-text-3)]">{m['ui.identity.billing']({ service: selected.service.label, count: Math.min(character.references.length, selected.service.maxImages) })}</p>
    </div> : services.data?.length ? <p className="text-xs text-[var(--vh-text-2)]">{m['ui.identity.connect']({ services: services.data.map(service => service.label).join(', ') })} <Link href="/connections" className="underline underline-offset-4">{m['ui.identity.open_connections']()}</Link></p> : null}
  </section>;
}
