import { useEffect, useState } from 'react';
import { TextField } from '@seed-design/react';
import { KeyRound } from 'lucide-react';
import { Action } from '@/components/base/action';

type Connection = { id: string; label: string; canTest: boolean; revision: string; fields: { name: string; source: 'workspace' | 'environment' | 'missing' }[] };
const headers = { 'Content-Type': 'application/json', 'x-viral-hit-workspace-request': '1' };
async function request(body?: unknown) {
  const response = await fetch('/api/app/provider-connections', { method: body ? 'POST' : 'GET', headers, cache: 'no-store', ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = await response.json();
  if (!response.ok) throw Error(data.error ?? 'Connection request failed');
  return data;
}
function ConnectionForm({ connection, ko, refresh }: { connection: Connection; ko: boolean; refresh: () => Promise<void> }) {
  const [values, setValues] = useState<Record<string, string>>({}), [busy, setBusy] = useState(false), [notice, setNotice] = useState(''), [error, setError] = useState('');
  const ready = connection.fields.every(field => field.source !== 'missing');
  const dirty = Object.values(values).some(value => value.trim());
  async function run(action: 'save' | 'test' | 'remove') {
    setBusy(true); setNotice(''); setError('');
    try {
      const changes = action === 'remove' ? Object.fromEntries(connection.fields.filter(field => field.source === 'workspace').map(field => [field.name, null])) : Object.fromEntries(Object.entries(values).filter(([, value]) => value.trim()));
      await request({ action: action === 'test' ? 'test' : 'save', providerId: connection.id, revision: connection.revision, ...(action !== 'test' ? { values: changes } : {}) });
      setValues({});
      await refresh();
      setNotice(action === 'test' ? (ko ? '인증을 확인했어요. 유료 생성과 결과 품질은 아직 테스트하지 않았어요.' : 'Authentication confirmed. Paid generation and output quality have not been tested.') : action === 'remove' ? (ko ? '저장된 키를 삭제했어요.' : 'Saved credentials removed.') : (ko ? '키를 저장했어요. 연결 확인을 눌러 인증을 확인하세요.' : 'Settings saved. Check the connection to verify authentication.'));
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Connection request failed'); }
    finally { setBusy(false); }
  }
  return <form onSubmit={event => { event.preventDefault(); void run('save'); }} className="min-w-0 space-y-4 rounded-2xl border border-[var(--vh-border)] bg-[var(--vh-surface)] p-5">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">{connection.label}</h3><span className="text-xs text-[var(--vh-text-2)]">{ready ? (ko ? '키 등록됨' : 'Settings saved') : (ko ? '연결 필요' : 'Needs connection')}</span></div>
    {connection.fields.map(field => <div key={field.name} className="min-w-0 space-y-2"><label htmlFor={connection.id + field.name} className="block break-words text-sm">{field.name.endsWith('API_KEY') ? connection.label + (ko ? ' API 키' : ' API key') : field.name}</label><TextField.Root className="vh-field"><TextField.Input id={connection.id + field.name} type="password" autoComplete="off" spellCheck={false} maxLength={8192} disabled={busy || field.source === 'environment'} value={values[field.name] ?? ''} placeholder={field.source === 'missing' ? (connection.id === 'higgsfield' ? 'KEY_ID:KEY_SECRET' : ko ? 'API 키 입력' : 'Enter an API key') : (ko ? '새 키로 바꿀 때만 입력' : 'Enter only to replace the saved key')} onChange={event => { setValues(previous => ({ ...previous, [field.name]: event.target.value })); setNotice(''); }} /></TextField.Root><p className="text-xs text-[var(--vh-text-2)]">{field.source === 'environment' ? (ko ? '서버 환경 설정에서 관리 중' : 'Managed by the server environment') : field.source === 'workspace' ? (ko ? '서버에 암호화하여 저장됨' : 'Encrypted in workspace storage') : (ko ? '등록된 키가 없어요' : 'No saved key')}</p></div>)}
    <div className="flex flex-wrap gap-2"><Action type="submit" disabled={busy || !dirty} className="vh-primary">{ko ? '키 저장' : 'Save settings'}</Action>{connection.canTest && <Action type="button" disabled={busy || !ready || dirty} className="vh-secondary" onClick={() => void run('test')}>{ko ? '연결 확인' : 'Check connection'}</Action>}{connection.fields.some(field => field.source === 'workspace') && <Action type="button" disabled={busy} className="vh-secondary" onClick={() => void run('remove')}>{ko ? '저장된 키 삭제' : 'Remove saved key'}</Action>}</div>
    {busy && <p role="status" className="text-sm">{ko ? '처리 중…' : 'Working…'}</p>}{notice && <p role="status" className="text-sm leading-6 text-[var(--vh-text-2)]">{notice}</p>}{error && <p role="alert" className="break-words text-sm text-red-700">{error}</p>}
  </form>;
}
export function ProviderConnections({ locale, onChange }: { locale: string; onChange: () => Promise<void> }) {
  const [connections, setConnections] = useState<Connection[]>([]), [error, setError] = useState('');
  const ko = locale.startsWith('ko');
  async function load() { const data = await request(); setConnections(data.providers); setError(''); }
  useEffect(() => { let active = true; request().then(data => { if (active) setConnections(data.providers); }).catch(() => { if (active) setError(ko ? 'API 연결 설정을 불러오지 못했어요.' : 'Could not load API connections.'); }); return () => { active = false; }; }, [ko]);
  if (!connections.length && !error) return null;
  return <section aria-label={ko ? '생성 API 연결' : 'Creative API connections'} className="space-y-4"><div className="space-y-2"><h2 className="flex items-center gap-2 text-xl font-semibold"><KeyRound size={20} />{ko ? '생성 API 연결' : 'Connect creative APIs'}</h2><p className="max-w-2xl text-sm leading-6 text-[var(--vh-text-2)]">{ko ? '키를 연결하면 설치된 모델을 생성창에서 선택할 수 있어요. 실제 생성에는 해당 서비스 요금이 들며, 참조로 선택한 파일은 생성할 때 서비스로 전송돼요.' : 'Connect a key to use installed models in the creation tools. Generation uses your provider balance and sends the references you select to that service.'}</p><p className="text-xs leading-5 text-[var(--vh-text-2)]">{ko ? '진행 중인 작업이 있다면 완료 후 키를 바꾸세요. 작업은 시작할 때의 키 설정과 연결돼요.' : 'Finish active jobs before changing keys. Jobs remain bound to their original configuration.'}</p></div>{error && <p role="alert" className="text-sm text-red-700">{error}</p>}<div className="grid items-start gap-4 md:grid-cols-2">{connections.map(connection => <ConnectionForm key={connection.id} connection={connection} ko={ko} refresh={async () => { await load(); await onChange(); }} />)}</div></section>;
}
