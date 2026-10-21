import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { Action } from '@/components/base/action';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { ViralHitSkillDescriptor } from '@/core/skills/contract';
import type { useSkills } from './use-skills';

export const scopeLabel = { general: 'General', specialized: 'For a specific job' };
export const sourceLabel = { official: 'Official', local: 'Operator folder', installed: 'Installed' };

export function SkillDescription({ skill, instructions, sourceName }: { skill: ViralHitSkillDescriptor; instructions: string; sourceName?: string }) {
  const { manifest } = skill;
  return <div className="space-y-5 text-sm">
    <p className="break-all font-mono text-xs text-[var(--vh-text-2)]">{manifest.id}</p>
    <p className="text-xs text-[var(--vh-text-2)]">{scopeLabel[manifest.scope]} · {sourceName ?? sourceLabel[skill.source]} · v{manifest.version}{manifest.author ? ' · ' + manifest.author : ''}{manifest.license ? ' · ' + manifest.license : ''}</p>
    {manifest.inputs.length > 0 && <section className="space-y-2"><h3 className="font-semibold">What you provide</h3><ul className="space-y-2">{manifest.inputs.map(input => <li key={input.id}><span className="font-medium">{input.label}</span>{!input.required && ' (optional)'}<p className="text-xs leading-5 text-[var(--vh-text-2)]">{input.description}</p></li>)}</ul></section>}
    {manifest.stages.length > 0 && <section className="space-y-2"><h3 className="font-semibold">Workflow</h3><ol className="space-y-2">{manifest.stages.map((stage, index) => <li key={stage.id}><span className="font-medium">{index + 1}. {stage.title}</span>{stage.reviewRequired && <span className="ml-2 rounded-full bg-[var(--color-brand-lime-soft)] px-2 py-0.5 text-[11px] text-[var(--color-lime-text)]">Review required</span>}<p className="text-xs leading-5 text-[var(--vh-text-2)]">{stage.description}</p></li>)}</ol></section>}
    <details className="rounded-xl border border-[var(--vh-border)] p-3"><summary className="cursor-pointer font-medium">Required tools ({manifest.compatibility.requiredMcpTools.length})</summary><ul className="mt-3 space-y-1 break-all font-mono text-[11px] text-[var(--vh-text-2)]">{manifest.compatibility.requiredMcpTools.map(tool => <li key={tool}>{tool}</li>)}</ul></details>
    <section className="space-y-2"><h3 className="font-semibold">Full instructions</h3><pre className="max-h-72 overflow-y-auto whitespace-pre-wrap break-words rounded-xl bg-[var(--vh-control)] p-4 font-mono text-xs leading-5">{instructions}</pre></section>
    <details className="rounded-xl border border-[var(--vh-border)] p-3"><summary className="cursor-pointer font-medium">Full manifest</summary><pre className="mt-3 max-h-64 overflow-y-auto whitespace-pre-wrap break-words text-xs leading-5">{JSON.stringify(manifest, null, 2)}</pre></details>
    {!skill.compatible && <ul className="space-y-1 rounded-xl bg-amber-500/10 p-3 text-xs text-amber-900">{skill.incompatibilities.map(reason => <li key={reason}>{reason}</li>)}</ul>}
  </div>;
}

export function SkillDetail({ library }: { library: ReturnType<typeof useSkills> }) {
  const { detail, review } = library;
  const [confirmed, setConfirmed] = useState(false);
  useEffect(() => setConfirmed(false), [review?.inspection.digest, review?.inspection.update?.digest]);
  const update = review?.inspection.update;
  const skill = review?.inspection.skill ?? detail;
  if (!skill) return null;
  return <Dialog open onOpenChange={open => { if (!open && !library.busy) library.close(); }}>
    <DialogContent className="max-h-[calc(100dvh-32px)] overflow-y-auto sm:max-w-2xl">
      <DialogHeader className="pr-7"><DialogTitle className="break-words">{update ? 'Review update: ' : review ? 'Review skill: ' : ''}{skill.manifest.title}</DialogTitle><DialogDescription>{skill.manifest.summary}</DialogDescription></DialogHeader>
      {update && <section aria-label="Installed version" className="space-y-3 rounded-xl border border-[var(--vh-border)] p-4">
        <p className="text-sm font-semibold">Installed v{update.current.manifest.version} → Incoming v{skill.manifest.version}</p>
        <p className="text-xs leading-5 text-[var(--vh-text-2)]">This replaces the skill with the same ID for future agent reads. Projects, past jobs and saved pack snapshots stay as they are.</p>
        <details><summary className="cursor-pointer text-sm font-medium">Read installed definition</summary><div className="mt-4"><p className="mb-3 text-sm">{update.current.manifest.title}: {update.current.manifest.summary}</p><SkillDescription skill={{ ...skill, source: 'installed', manifest: update.current.manifest, compatible: !update.currentIncompatibilities.length, incompatibilities: update.currentIncompatibilities }} instructions={update.current.instructions} /></div></details>
        <Action className="vh-secondary text-xs" disabled={library.busy} onClick={() => void library.download(skill.manifest.id, update.current)}>Download installed version</Action>
      </section>}
      {update && <h3 className="text-sm font-semibold">Incoming definition</h3>}
      <SkillDescription skill={skill} sourceName={review && review.inspection.collision !== 'same' ? 'Shared file' : undefined} instructions={review?.file.instructions ?? detail!.instructions} />
      {review?.source && <p className="break-all text-xs text-[var(--vh-text-2)]">From {review.source}</p>}
      {(update?.blocking ?? review?.inspection.blocking)?.map(reason => <p key={reason} className="text-xs text-amber-900">{reason}</p>)}
      {library.error && <p role="alert" className="whitespace-pre-wrap break-words rounded-lg bg-red-500/10 p-3 text-xs text-red-800">{library.error}</p>}
      <div className="sticky -bottom-6 z-10 -mx-6 -mb-6 space-y-3 border-t border-[var(--vh-border)] bg-[var(--vh-surface)] px-6 py-4">
        <p className="text-xs leading-5 text-[var(--vh-text-2)]">{update ? 'Review both definitions before replacing this skill.' : review ? 'Installing makes these instructions available to your agent. It starts no jobs.' : 'Ask your connected agent to read ' + skill.manifest.id + ' and follow it for your project.'}</p>
        {update && <label className="flex items-start gap-2 text-xs leading-5"><input type="checkbox" className="mt-1" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /><span>I reviewed the installed and incoming skill definitions.</span></label>}
        <div className="flex gap-2"><Action disabled={library.busy} onClick={library.close} className="vh-secondary flex-1">{review ? 'Cancel' : 'Done'}</Action>{review
          ? <Action disabled={library.busy || (update?.blocking ?? review.inspection.blocking).length > 0 || (!!update && !confirmed)} onClick={() => void library.install()} className="vh-primary flex-1">{library.busy ? 'Saving…' : update ? 'Update skill' : review.inspection.collision === 'same' ? 'Already installed' : 'Install skill'}</Action>
          : <Action disabled={library.busy} onClick={() => void library.download(skill.manifest.id)} className="vh-primary flex-1"><Download size={15} aria-hidden="true" />Download skill</Action>}</div>
        {!review && skill.source === 'installed' && <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs text-[var(--vh-text-2)]">To update, import a file with the same ID.</p><Action className="vh-secondary text-xs" disabled={library.busy} onClick={() => void library.reviewRemoval(skill.manifest.id)}>Remove skill…</Action></div>}
      </div>
    </DialogContent>
  </Dialog>;
}
