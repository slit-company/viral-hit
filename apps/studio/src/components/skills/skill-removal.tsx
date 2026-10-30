import { m as uiMessages } from '@/paraglide/messages.js';
import { useState } from 'react';
import { Action } from '@/components/base/action';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { useSkills } from './use-skills';

export function SkillRemoval({ library }: { library: ReturnType<typeof useSkills> }) {
  const review = library.removal!, [confirmed, setConfirmed] = useState(false);
  return <Dialog open onOpenChange={open => { if (!open && !library.busy) library.close(); }}>
    <DialogContent className="max-h-[calc(100dvh-32px)] overflow-y-auto sm:max-w-xl">
      <DialogHeader className="pr-7"><DialogTitle className="break-words">{uiMessages["ui.skills.remove"]()} {review.file.manifest.title}?</DialogTitle><DialogDescription>{uiMessages["ui.skills.this_removes_the_installed_skill_from_future_library_and_agent_reads_an_age"]()}</DialogDescription></DialogHeader>
      <p className="break-all text-xs text-[var(--vh-text-2)]">{review.file.manifest.id} · v{review.file.manifest.version}</p>
      <p className="text-sm leading-6">{uiMessages["ui.skills.projects_generated_media_previous_jobs_and_saved_pack_snapshots_are_kept_yo"]()}</p>
      <details className="rounded-xl border border-[var(--vh-border)] p-3"><summary className="cursor-pointer text-sm font-medium">{uiMessages["ui.skills.read_the_instructions_being_removed"]()}</summary><pre className="mt-3 max-h-48 overflow-y-auto whitespace-pre-wrap break-words text-xs leading-5">{review.file.instructions}</pre></details>
      <Action disabled={library.busy} onClick={() => void library.download(review.file.manifest.id, review.file)} className="vh-secondary justify-self-start">{uiMessages["ui.skills.download_skill_first"]()}</Action>
      {library.error && <p role="alert" className="break-words text-sm text-red-800">{library.error}</p>}
      <label className="flex items-start gap-3 text-sm leading-6"><input type="checkbox" className="mt-1.5 shrink-0" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /><span>{uiMessages["ui.skills.remove_this_reviewed_version_from_my_skill_library"]()}</span></label>
      <div className="flex gap-3"><Action disabled={library.busy} onClick={library.close} className="vh-secondary flex-1">{uiMessages["product.history.cancel"]()}</Action><Action disabled={library.busy || !confirmed} onClick={() => void library.remove()} className="vh-primary flex-1">{library.busy ? uiMessages["ui.common.removing"]() : uiMessages["ui.skills.remove_skill_2"]()}</Action></div>
    </DialogContent>
  </Dialog>;
}
