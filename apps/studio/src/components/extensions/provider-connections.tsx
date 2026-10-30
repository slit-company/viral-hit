import { useEffect, useState } from 'react';
import { TextField } from '@seed-design/react';
import { ArrowUpRight, Check, KeyRound } from 'lucide-react';
import { Action } from '@/components/base/action';

type Field = { name: string; source: 'workspace' | 'environment' | 'missing' };
type Connection = { id: string; label: string; canTest: boolean; revision: string; modelCount: number; description?: string; setupUrl?: string; keyFormat?: string; fields: Field[] };
const headers = { 'Content-Type': 'application/json', 'x-viral-hit-workspace-request': '1' };
async function request(body?: unknown) {
  const response = await fetch('/api/app/provider-connections', { method: body ? 'POST' : 'GET', headers, cache: 'no-store', ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = await response.json();
  if (!response.ok) throw Error(data.error ?? 'Connection request failed');
  return data;
}

const copy = (ko: boolean) => ({
  connected: ko ? '연결됨' : 'Connected', missing: ko ? '키 필요' : 'Needs a key', models: (count: number) => ko ? '모델 ' + count + '개' : count + (count === 1 ? ' model' : ' models'),
  getKey: ko ? '키 발급' : 'Get a key', paste: ko ? 'API 키 붙여넣기' : 'Paste an API key', replace: ko ? '새 키로 바꿀 때만 입력' : 'Paste only to replace the saved key',
  save: ko ? '저장' : 'Save', check: ko ? '연결 확인' : 'Check', remove: ko ? '키 삭제' : 'Remove key', working: ko ? '처리 중…' : 'Working…',
  environment: ko ? '서버 환경 설정에서 관리 중' : 'Managed by the server environment',
  saved: ko ? '키를 저장했어요. 연결 확인으로 인증을 확인하세요.' : 'Saved. Press Check to confirm the key works.',
  tested: ko ? '인증을 확인했어요. 생성 요금과 결과 품질은 해당 서비스에서 확인하세요.' : 'Key confirmed. Generation is billed by this service.',
  removed: ko ? '저장된 키를 삭제했어요.' : 'Saved key removed.',
});

function ConnectionRow({ connection, ko, refresh }: { connection: Connection; ko: boolean; refresh: () => Promise<void> }) {
  const [values, setValues] = useState<Record<string, string>>({}), [busy, setBusy] = useState(false), [notice, setNotice] = useState(''), [error, setError] = useState('');
  const text = copy(ko), ready = connection.fields.every(field => field.source !== 'missing'), dirty = Object.values(values).some(value => value.trim());
  async function run(action: 'save' | 'test' | 'remove') {
    setBusy(true); setNotice(''); setError('');
    try {
      const changes = action === 'remove' ? Object.fromEntries(connection.fields.filter(field => field.source === 'workspace').map(field => [field.name, null])) : Object.fromEntries(Object.entries(values).filter(([, value]) => value.trim()));
      await request({ action: action === 'test' ? 'test' : 'save', providerId: connection.id, revision: connection.revision, ...(action !== 'test' ? { values: changes } : {}) });
      setValues({});
      await refresh();
      setNotice(action === 'test' ? text.tested : action === 'remove' ? text.removed : text.saved);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Connection request failed'); }
    finally { setBusy(false); }
  }
  return <form aria-label={connection.label} onSubmit={event => { event.preventDefault(); void run('save'); }} className="min-w-0 space-y-3 rounded-2xl border border-[var(--vh-border)] bg-[var(--vh-surface)] p-4">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">{connection.label}</h3><span className={'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ' + (ready ? 'bg-[var(--color-brand-lime-soft)] text-[var(--color-lime-text)]' : 'bg-[var(--vh-control)] text-[var(--vh-text-2)]')}>{ready && <Check size={11} aria-hidden="true" />}{ready ? text.connected : text.missing}</span></div>
        <p className="mt-1 line-clamp-2 text-xs leading-5 text-[var(--vh-text-2)]">{text.models(connection.modelCount)}{connection.description ? ' · ' + connection.description : ''}</p>
      </div>
      {connection.setupUrl && <a href={connection.setupUrl} target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-1 text-xs font-medium underline-offset-4 hover:underline">{text.getKey}<ArrowUpRight size={12} aria-hidden="true" /></a>}
    </div>
    {connection.fields.map(field => field.source === 'environment' ? <p key={field.name} className="text-xs text-[var(--vh-text-2)]">{field.name} · {text.environment}</p> :
      <TextField.Root key={field.name} className="vh-field"><TextField.Input aria-label={connection.fields.length === 1 ? connection.label + (ko ? ' API 키' : ' API key') : connection.label + ' ' + field.name} type="password" autoComplete="off" spellCheck={false} maxLength={8192} disabled={busy} value={values[field.name] ?? ''} placeholder={field.source === 'missing' ? (connection.keyFormat ?? text.paste) : text.replace} onChange={event => { setValues(previous => ({ ...previous, [field.name]: event.target.value })); setNotice(''); }} /></TextField.Root>)}
    <div className="flex flex-wrap items-center gap-2">
      <Action type="submit" disabled={busy || !dirty} className="vh-primary">{text.save}</Action>
      {connection.canTest && <Action type="button" disabled={busy || !ready || dirty} className="vh-secondary" onClick={() => void run('test')}>{text.check}</Action>}
      {connection.fields.some(field => field.source === 'workspace') && <Action type="button" disabled={busy} className="vh-secondary" onClick={() => void run('remove')}>{text.remove}</Action>}
      {busy && <span role="status" className="text-xs text-[var(--vh-text-2)]">{text.working}</span>}
    </div>
    {notice && <p role="status" className="text-xs leading-5 text-[var(--vh-text-2)]">{notice}</p>}{error && <p role="alert" className="break-words text-xs text-red-700">{error}</p>}
  </form>;
}

/** API keys for installed model services; connected services are listed first. */
export function ProviderConnections({ locale, onChange }: { locale: string; onChange?: () => Promise<void> }) {
  const [connections, setConnections] = useState<Connection[]>([]), [error, setError] = useState('');
  const ko = locale.startsWith('ko');
  async function load() { const data = await request(); setConnections(data.providers); setError(''); }
  useEffect(() => { let active = true; request().then(data => { if (active) setConnections(data.providers); }).catch(() => { if (active) setError(ko ? 'API 연결 설정을 불러오지 못했어요.' : 'Could not load API connections.'); }); return () => { active = false; }; }, [ko]);
  if (!connections.length && !error) return null;
  const ordered = [...connections].sort((a, b) => Number(b.fields.every(field => field.source !== 'missing')) - Number(a.fields.every(field => field.source !== 'missing')));
  return <section aria-label={ko ? '모델 API' : 'Model APIs'} className="space-y-4">
    <div className="space-y-1.5"><h2 className="flex items-center gap-2 text-xl font-semibold"><KeyRound size={20} aria-hidden="true" />{ko ? '모델 API' : 'Model APIs'}</h2><p className="max-w-2xl text-sm leading-6 text-[var(--vh-text-2)]">{ko ? '쓰고 싶은 서비스의 키만 붙여넣으세요. 키는 서버에 암호화되어 저장되고, 생성 요금은 해당 서비스 계정에 청구돼요.' : 'Paste keys only for the services you want. Keys are encrypted on your server, and each service bills its own account.'}</p></div>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    <div className="grid items-start gap-3 md:grid-cols-2">{ordered.map(connection => <ConnectionRow key={connection.id} connection={connection} ko={ko} refresh={async () => { await load(); await onChange?.(); }} />)}</div>
  </section>;
}
