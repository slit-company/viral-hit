import { m as uiMessages } from '@/paraglide/messages.js';
import { useState } from 'react';
import { Archive, ArrowDownToLine, ArrowUpFromLine, Check } from 'lucide-react';
import { Action } from '@/components/base/action';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useProjectBundle } from './use-project-bundle';

const fileSize = (bytes: number) => bytes < 1048576 ? `${Math.max(1, Math.ceil(bytes / 1024))} KB` : `${(bytes / 1048576).toFixed(1)} MB`;

export function ProjectBundleDialog({ projectId }: { projectId?: string | null }) {
  const [open, setOpen] = useState(false);
  const state = useProjectBundle(projectId);
  const summary = state.review?.summary;
  return <>
    <Action aria-label={projectId ? uiMessages["ui.project-bundles.project_file"]() : uiMessages["ui.project-bundles.import_project_file"]()} title={uiMessages["ui.project-bundles.project_file"]()} onClick={() => setOpen(true)} className={projectId ? 'inline-flex size-9 shrink-0 items-center justify-center rounded-xl border border-border bg-muted text-muted-foreground' : 'vh-secondary inline-flex items-center gap-2 self-start'}>
      <Archive size={17} aria-hidden="true" />{!projectId && <span className="max-sm:sr-only">{uiMessages["ui.project-bundles.import_project"]()}</span>}
    </Action>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[calc(100dvh-32px)] overflow-y-auto">
        <DialogHeader>
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">{uiMessages["ui.project-bundles.viral_hit_project_file"]()}</p>
          <DialogTitle className="pr-6 text-2xl">{uiMessages["ui.project-bundles.take_your_work_with_you"]()}</DialogTitle>
          <DialogDescription>Original media, storyboards, Canvas and editable timelines in one portable file.</DialogDescription>
        </DialogHeader>
        {projectId && <section className="space-y-3 rounded-2xl border border-border p-4" aria-label={uiMessages["ui.project-bundles.export_project_file"]()}>
          <h3 className="flex items-center gap-2 font-semibold"><ArrowDownToLine size={17} />{uiMessages["ui.project-bundles.export_this_project"]()}</h3>
          <p className="text-sm leading-relaxed text-muted-foreground">{uiMessages["ui.project-bundles.uses_saved_edits_finish_saving_before_preparing_your_file"]()}</p>
          <Action className="vh-secondary" disabled={Boolean(state.busy)} onClick={() => void state.prepare()}>{uiMessages["ui.project-bundles.prepare_project_file"]()}</Action>
          {state.prepared && <div className="space-y-2" role="status">
            <p className="text-sm">{state.prepared.summary.assetCount} {uiMessages["ui.project-bundles.media"]()} {state.prepared.summary.clipCount} {uiMessages["ui.editor.clips"]()} {state.prepared.summary.storyboardCount} storyboards · {fileSize(state.prepared.sizeBytes)}</p>
            <a className="vh-primary inline-flex items-center justify-center" href={state.prepared.downloadUrl} download>{uiMessages["ui.project-bundles.download_project_file"]()}</a>
          </div>}
        </section>}
        <section className="space-y-3 rounded-2xl border border-border p-4" aria-label={uiMessages["ui.project-bundles.import_project_file"]()}>
          <h3 className="flex items-center gap-2 font-semibold"><ArrowUpFromLine size={17} />{uiMessages["ui.project-bundles.import_a_project"]()}</h3>
          <p className="text-sm leading-relaxed text-muted-foreground">{uiMessages["ui.project-bundles.choose_a_viralhit_tar_file_we_ll_verify_its_contents_before_creating_a_new_"]()}</p>
          <input aria-label={uiMessages["ui.project-bundles.choose_project_file"]()} type="file" accept=".tar,application/x-tar" disabled={Boolean(state.busy)} className="block w-full min-w-0 text-sm file:mr-3 file:rounded-xl file:border-0 file:bg-muted file:px-3 file:py-2 file:text-foreground" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void state.inspect(file); }} />
          {summary && <div className="space-y-3 rounded-xl bg-muted p-3" aria-label={uiMessages["ui.project-bundles.verified_project_contents"]()}>
            <p className="flex items-start gap-2 font-semibold"><Check size={17} className="mt-0.5 shrink-0" /><span className="break-words">{summary.name}</span></p>
            <p className="text-sm">{summary.assetCount} {uiMessages["ui.project-bundles.media"]()} {summary.cardCount} {uiMessages["ui.project-bundles.cards"]()} {summary.clipCount} {uiMessages["ui.project-bundles.clips"]()}</p>
            <p className="text-sm">{summary.storyboardCount} storyboards · {summary.acceptedShotCount} accepted shots</p>
            {!!summary.recipeRequirements.length && <details className="text-xs leading-5"><summary className="cursor-pointer font-medium">Recipes to review ({summary.recipeRequirements.length})</summary><p className="mt-2">Download these definitions and review them in the recipe library before generating new attempts.</p><ul className="mt-2 space-y-2">{summary.recipeRequirements.map(recipe => <li key={recipe.digest} className="break-words">{recipe.title} · {recipe.id} · v{recipe.version}<span className="block break-all font-mono">{recipe.digest}</span><a className="inline-block underline underline-offset-4" href={`/api/app/project-bundles/${state.review!.id}/recipes/${recipe.digest}`} download>Download {recipe.title}</a></li>)}</ul></details>}
            <p className="text-xs text-muted-foreground">{summary.mediaBytes ? fileSize(summary.mediaBytes) : "No"} {uiMessages["ui.project-bundles.original_media_checksum_verified"]()}</p>
            {state.imported ? <a className="vh-primary inline-flex items-center justify-center" href={`/editor/${state.imported}`}>{uiMessages["ui.project-bundles.open_imported_project"]()}</a> : <Action className="vh-primary" disabled={Boolean(state.busy)} onClick={() => void state.accept()}>{uiMessages["ui.project-bundles.create_new_project"]()}</Action>}
          </div>}
        </section>
        <p className="text-xs leading-relaxed text-muted-foreground">{uiMessages["ui.project-bundles.accounts_and_running_jobs_stay_on_this_installation_importing_starts_no_gen"]()}</p>
        {state.busy && <div role="status" className="flex items-center justify-between gap-3 text-sm"><span>{state.busy}</span><Action className="vh-secondary" onClick={state.cancel}>{uiMessages["ui.project-bundles.stop"]()}</Action></div>}
        {state.error && <p role="alert" className="break-words text-sm text-destructive">{state.error}</p>}
      </DialogContent>
    </Dialog>
  </>;
}
