import { useEffect, useRef } from 'react';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';

export function ProjectListControls({ value, onChange, sort, onSort, copy }: {
  value: string; onChange: (value: string) => void; sort: 'recent' | 'name'; onSort: (sort: 'recent' | 'name') => void;
  copy: { search: string; sortLabel: string; sortRecent: string; sortName: string };
}) {
  const field = useRef<HTMLInputElement>(null);
  // Keep text typed before the page finished hydrating.
  useEffect(() => { const typed = field.current?.value ?? ''; if (typed && typed !== value) onChange(typed); }, []);
  return (
    <div className="mt-10 flex flex-wrap items-center gap-3">
      <label className="relative min-w-0 flex-1 basis-64">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--vh-text-3)]" aria-hidden="true" />
        <Input ref={field} type="search" aria-label={copy.search} placeholder={copy.search} value={value} onChange={event => onChange(event.target.value)} className="h-10 pl-9" />
      </label>
      <NativeSelect aria-label={copy.sortLabel} value={sort} onChange={event => onSort(event.target.value === 'name' ? 'name' : 'recent')} className="w-auto">
        <option value="recent">{copy.sortRecent}</option>
        <option value="name">{copy.sortName}</option>
      </NativeSelect>
    </div>
  );
}

