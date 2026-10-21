import { useRef, useState } from 'react';
import { TextField } from '@seed-design/react';
import { BookOpen, FileUp } from 'lucide-react';
import { ProductShell } from '@/components/marketing/product-shell';
import { Action } from '@/components/base/action';
import { SkillDetail, scopeLabel, sourceLabel } from './skill-detail';
import { SkillRemoval } from './skill-removal';
import { useSkills } from './use-skills';

export function SkillsPage({ locale }: { locale: string }) {
  const library = useSkills(), fileInput = useRef<HTMLInputElement>(null);
  const [link, setLink] = useState(''), [scope, setScope] = useState<'all' | 'general' | 'specialized'>('all');
  const skills = library.catalog?.skills.filter(skill => scope === 'all' || skill.manifest.scope === scope);
  return <ProductShell active="skills" locale={locale}>
    <main className="mx-auto w-full max-w-[1280px] px-5 pb-12 pt-14 sm:px-6">
      <section className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div><p className="text-[11px] font-semibold tracking-[0.18em] text-[var(--vh-accent)]">SKILLS</p><h1 className="vh-product-display mt-4 text-[clamp(2.25rem,4.5vw,3.25rem)] font-semibold leading-[1.1] tracking-[-0.04em]">Give your agent a way to work.</h1><p className="mt-4 max-w-2xl text-[15px] leading-6 text-[var(--vh-text-2)]">Use a workflow for any project, or add one made for a particular job. Read the steps, install it, then ask your agent to use it.</p></div>
        <input ref={fileInput} type="file" accept=".json,application/json" aria-label="Import skill file" className="hidden" onChange={event => { void library.importFile(event.target.files?.[0]); event.target.value = ''; }} />
        <Action disabled={library.busy || !library.catalog} onClick={() => fileInput.current?.click()} className="vh-primary self-start"><FileUp size={16} aria-hidden="true" />Import skill file</Action>
      </section>
      <form className="mt-8 flex flex-col gap-2 rounded-2xl border border-[var(--vh-border)] bg-[var(--vh-surface)] p-4 sm:flex-row sm:items-end" onSubmit={event => { event.preventDefault(); void library.fetchLink(link); }}>
        <div className="min-w-0 flex-1 space-y-2"><label htmlFor="skill-link" className="block text-xs font-medium">Add from link</label><TextField.Root className="vh-field"><TextField.Input id="skill-link" aria-label="Add from link" type="url" placeholder="https://github.com/…/my.viralhit-skill.json" value={link} maxLength={2000} onChange={event => setLink(event.target.value)} /></TextField.Root></div><Action type="submit" disabled={!library.catalog || library.busy || !/^https:\/\/\S+$/.test(link.trim())} className="vh-secondary">Review link</Action>
      </form>
      {library.notice && <p role="status" className="mt-4 rounded-xl bg-[var(--color-brand-lime-soft)] p-3 text-sm text-[var(--color-lime-text)]">{library.notice}</p>}
      {library.error && !library.review && !library.detail && !library.removal && <p role="alert" className="mt-4 whitespace-pre-wrap break-words rounded-xl bg-red-500/10 p-3 text-sm text-red-800">{library.error}</p>}
      <section aria-label="Skill library" className="mt-8 space-y-5">
        <div role="group" aria-label="Filter skills" className="flex flex-wrap gap-2">{(['all', 'general', 'specialized'] as const).map(value => <Action key={value} disabled={!library.catalog} aria-pressed={scope === value} onClick={() => setScope(value)} className={'rounded-full border px-4 py-2 text-xs font-medium ' + (scope === value ? 'border-[var(--vh-text-1)] bg-[var(--vh-text-1)] text-[var(--vh-bg)]' : 'border-[var(--vh-border)] text-[var(--vh-text-2)]')}>{value === 'all' ? 'All skills' : scopeLabel[value]}</Action>)}</div>
        {!skills && <p className="text-sm text-[var(--vh-text-2)]">Loading skills…</p>}
        {skills?.length === 0 && <p className="rounded-2xl border border-dashed border-[var(--vh-border)] px-6 py-12 text-center text-sm text-[var(--vh-text-2)]">No skills in this group yet. Import a skill file or add a shared link.</p>}
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{skills?.map(skill => <li key={skill.manifest.id} className="flex min-w-0 flex-col gap-3 rounded-2xl border border-[var(--vh-border)] bg-[var(--vh-surface)] p-5">
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]"><span className="rounded-full bg-[var(--vh-control)] px-2 py-1 font-medium">{scopeLabel[skill.manifest.scope]}</span><span className="text-[var(--vh-text-2)]">{sourceLabel[skill.source]}</span></div>
          <h2 className="break-words text-base font-semibold">{skill.manifest.title}</h2><p className="break-all text-xs text-[var(--vh-text-2)]">{skill.manifest.id} · v{skill.manifest.version}</p><p className="text-sm leading-6 text-[var(--vh-text-2)]">{skill.manifest.summary}</p>
          <p className="text-xs text-[var(--vh-text-2)]">{skill.manifest.stages.length} steps · {skill.compatible ? 'Ready for your agent' : 'Needs setup'}</p>
          <Action disabled={library.busy} onClick={() => void library.open(skill.manifest.id)} aria-label={'Read ' + skill.manifest.title + ' (' + skill.manifest.id + ')'} className="vh-secondary mt-auto self-start text-xs"><BookOpen size={14} aria-hidden="true" />Read skill</Action>
        </li>)}</ul>
      </section>
      {!!library.catalog?.problems.length && <section aria-label="Skill problems" className="mt-8 space-y-2 rounded-2xl border border-amber-500/30 p-4"><h2 className="text-sm font-semibold">Some skills could not load</h2>{library.catalog.problems.map((problem, index) => <p key={index} className="break-words text-xs leading-5 text-[var(--vh-text-2)]">{problem.location}: {problem.message}</p>)}</section>}
    </main>
    <SkillDetail library={library} />
    {library.removal && <SkillRemoval key={library.removal.digest} library={library} />}
  </ProductShell>;
}
