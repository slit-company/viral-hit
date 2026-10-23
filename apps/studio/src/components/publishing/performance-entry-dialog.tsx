import { useState } from 'react';
import { Action } from '@/components/base/action';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import type { MeasurementRequest } from '@/core/measurement/contract';
import { metricLabel } from './performance-format';
import type { PerformanceItem } from './use-performance';

const localNow = () => { const now = new Date(); now.setMinutes(now.getMinutes() - now.getTimezoneOffset()); return now.toISOString().slice(0, 16); };

/** Numbers read from a platform dashboard. Blank fields are left out, never saved as zero. */
export function PerformanceEntryDialog({ item, open, onOpenChange, pending, change }: {
  item: PerformanceItem; open: boolean; onOpenChange: (open: boolean) => void; pending: boolean; change: (request: MeasurementRequest) => Promise<boolean>;
}) {
  const names = item.declaredMetrics.length ? item.declaredMetrics : ['views', 'likes', 'comments', 'shares'];
  const [values, setValues] = useState<Record<string, string>>({}), [observed, setObserved] = useState(localNow), [note, setNote] = useState('');
  const metrics = Object.fromEntries(Object.entries(values).filter(([, value]) => value.trim() !== '').map(([name, value]) => [name, Number(value)]));
  const valid = Object.keys(metrics).length > 0 && Object.values(metrics).every(value => Number.isFinite(value) && value >= 0) && Boolean(observed);
  async function save() {
    const saved = await change({ action: 'record', publicationId: item.publicationId, requestKey: 'ui:' + crypto.randomUUID(), metrics, observedAt: new Date(observed).toISOString(), ...(note.trim() ? { note: note.trim() } : {}) });
    if (saved) { setValues({}); setNote(''); onOpenChange(false); }
  }
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-h-[calc(100dvh-32px)] overflow-y-auto sm:max-w-lg">
      <DialogHeader><DialogTitle>Enter numbers</DialogTitle><DialogDescription>Copy what the platform shows for “{item.title}”. Leave a field blank if you don’t know it.</DialogDescription></DialogHeader>
      <div className="grid grid-cols-2 gap-3">
        {names.map(name => <label key={name} className="space-y-1 text-sm"><span className="text-[var(--vh-text-2)]">{metricLabel(name)}</span><Input aria-label={metricLabel(name)} inputMode="numeric" type="number" min={0} step="any" value={values[name] ?? ''} onChange={event => setValues({ ...values, [name]: event.target.value })} /></label>)}
      </div>
      <label className="block space-y-1 text-sm"><span className="text-[var(--vh-text-2)]">Observed at</span><Input aria-label="Observed at" type="datetime-local" value={observed} onChange={event => setObserved(event.target.value)} /></label>
      <label className="block space-y-1 text-sm"><span className="text-[var(--vh-text-2)]">Note (optional)</span><Input aria-label="Note" maxLength={500} value={note} onChange={event => setNote(event.target.value)} /></label>
      <div className="flex justify-end gap-2"><Action className="vh-secondary" onClick={() => onOpenChange(false)}>Cancel</Action><Action className="vh-primary" disabled={pending || !valid} onClick={() => void save()}>Save numbers</Action></div>
    </DialogContent>
  </Dialog>;
}
