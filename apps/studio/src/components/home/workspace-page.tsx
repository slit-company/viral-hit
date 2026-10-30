import { ProjectBundleDialog } from '@/components/project-bundles/project-bundle-dialog';
import { Action } from '@/components/base/action';
import {
  FolderClock,
  PanelsTopLeft,
  Plus,
  Trash2,
  Workflow,
} from 'lucide-react';
import { useState } from 'react';

import { ProductShell } from '@/components/marketing/product-shell';
import { normalizeLocale } from '@/config/locale';
import { ConfirmDialog } from '@/components/confirm-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Link } from '@/core/i18n/navigation';
import { buildLocalizedProjectDetailPath, buildPostCreateProjectDetailPath } from '@/core/projects/project-entry';
import { apiJsonPost } from '@/lib/api-client';
import { useWorkspaceProjects } from '@/core/workspace-hooks/use-workspace-projects';
import type { WorkspaceProjectCardItem } from '@/core/workspace-lib/app/workspace-client-api';
import { m } from '@/paraglide/messages.js';
import { ProjectListControls } from './project-list-controls';
import { useProjectSearch } from './use-project-search';

function getHistoryCopy(locale: string) {
  const messageLocale = normalizeLocale(locale);
  return {
    eyebrow: m['product.history.eyebrow']({}, { locale: messageLocale }),
    title: m['product.history.title']({}, { locale: messageLocale }),
    subtitle: m['product.history.subtitle']({}, { locale: messageLocale }),
    newProject: m['product.history.newProject']({}, { locale: messageLocale }),
    newStudio: m['product.history.newStudio']({}, { locale: messageLocale }),
    newCanvas: m['product.history.newCanvas']({}, { locale: messageLocale }),
    createTitle: m['product.history.createTitle'](
      {},
      { locale: messageLocale }
    ),
    createDescription: m['product.history.createDescription'](
      {},
      { locale: messageLocale }
    ),
    studioDescription: m['product.history.studioDescription'](
      {},
      { locale: messageLocale }
    ),
    canvasDescription: m['product.history.canvasDescription'](
      {},
      { locale: messageLocale }
    ),
    untitled: m['product.history.untitled']({}, { locale: messageLocale }),
    deleteConfirm: (projectName: string) =>
      m['product.history.deleteConfirm'](
        { projectName },
        { locale: messageLocale }
      ),
    deleteConfirmDescription: m['product.history.deleteConfirmDescription'](
      {},
      { locale: messageLocale }
    ),
    cancel: m['product.history.cancel']({}, { locale: messageLocale }),
    openProject: (projectName: string) =>
      m['product.history.openProject'](
        { projectName },
        { locale: messageLocale }
      ),
    deleteProject: m['product.history.deleteProject'](
      {},
      { locale: messageLocale }
    ),
    startFirst: m['product.history.startFirst'](
      {},
      { locale: messageLocale }
    ),
    emptyDescription: m['product.history.emptyDescription'](
      {},
      { locale: messageLocale }
    ),
    search: m['product.history.search']({}, { locale: messageLocale }),
    sortLabel: m['product.history.sortLabel']({}, { locale: messageLocale }),
    sortRecent: m['product.history.sortRecent']({}, { locale: messageLocale }),
    sortName: m['product.history.sortName']({}, { locale: messageLocale }),
    showMore: m['product.history.showMore']({}, { locale: messageLocale }),
    noMatches: m['product.history.noMatches']({}, { locale: messageLocale }),
  };
}

type HistoryCopy = ReturnType<typeof getHistoryCopy>;

function projectName(name: string, untitled: string) {
  const trimmed = name.trim();
  if (
    trimmed &&
    trimmed !== 'Untitled canvas' &&
    trimmed !== 'Untitled project'
  ) {
    return trimmed;
  }
  return untitled;
}

function CreateProjectDialog({
  open,
  onOpenChange,
  copy,
  locale,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  copy: HistoryCopy;
  locale: string;
}) {
  const [creating, setCreating] = useState<'studio' | 'canvas' | null>(null);
  // The user already chose a workspace here, so create the project now instead of asking again on /studio or /canvas.
  // The links stay as a fallback when scripts are unavailable.
  async function create(event: { preventDefault: () => void }, mode: 'studio' | 'canvas') {
    event.preventDefault();
    if (creating) return;
    setCreating(mode);
    try {
      const project = await apiJsonPost<{ id?: string }>('/api/app/projects', { name: copy.untitled, workspaceMode: mode });
      if (!project?.id) throw Error('Project was not created');
      window.location.assign(buildPostCreateProjectDetailPath({ locale, projectId: project.id, mode }));
    } catch {
      window.location.assign(mode === 'studio' ? '/studio' : '/canvas');
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden rounded-[26px] border border-[var(--vh-border)] bg-[var(--vh-surface)] p-0 text-[var(--vh-text-1)] shadow-none ring-0 sm:max-w-[620px] [&_[data-slot=dialog-close]]:right-4 [&_[data-slot=dialog-close]]:top-4 [&_[data-slot=dialog-close]]:text-[var(--vh-text-2)] [&_[data-slot=dialog-close]]:hover:bg-[var(--vh-control)] [&_[data-slot=dialog-close]]:hover:text-[var(--vh-text-1)]">
        <DialogHeader className="border-b border-[var(--vh-border)] px-6 pb-5 pt-6 text-left sm:px-7">
          <DialogTitle className="vh-product-display text-[24px] font-semibold tracking-[-0.035em] text-[var(--vh-text-1)]">
            {copy.createTitle}
          </DialogTitle>
          <DialogDescription className="w-full text-[13px] leading-6 text-[var(--vh-text-2)] sm:whitespace-nowrap">
            {copy.createDescription}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 p-4 sm:grid-cols-2 sm:p-5">
          <Link
            href="/studio"
            onClick={event => void create(event, 'studio')}
            aria-busy={creating === 'studio'}
            className="group relative min-h-[190px] overflow-hidden rounded-[20px] border border-[var(--vh-border-strong)]/35 bg-[var(--vh-surface)] p-5 transition hover:-translate-y-0.5 hover:border-[var(--vh-border-strong)]/65 hover:bg-[var(--vh-surface)]"
          >
            <span className="grid size-11 place-items-center rounded-[14px] bg-[var(--vh-accent)] text-[var(--vh-text-2)] shadow-none">
              <PanelsTopLeft className="size-5" />
            </span>
            <h2 className="vh-product-display mt-8 text-[18px] font-semibold tracking-[-0.025em] text-[var(--vh-text-1)]">
              {copy.newStudio}
            </h2>
            <p className="mt-2 max-w-[220px] text-[12px] leading-5 text-[var(--vh-text-2)]">
              {copy.studioDescription}
            </p>
          </Link>

          <Link
            href="/canvas"
            onClick={event => void create(event, 'canvas')}
            aria-busy={creating === 'canvas'}
            className="group relative min-h-[190px] overflow-hidden rounded-[20px] border border-[var(--vh-border)] bg-[var(--vh-surface)] p-5 transition hover:-translate-y-0.5 hover:border-[var(--vh-border)] hover:bg-[var(--vh-surface)]"
          >
            <span className="grid size-11 place-items-center rounded-[14px] border border-[var(--vh-border)] bg-[var(--vh-surface)] text-[var(--vh-text-1)]">
              <Workflow className="size-5" />
            </span>
            <h2 className="vh-product-display mt-8 text-[18px] font-semibold tracking-[-0.025em] text-[var(--vh-text-1)]">
              {copy.newCanvas}
            </h2>
            <p className="mt-2 max-w-[220px] text-[12px] leading-5 text-[var(--vh-text-2)]">
              {copy.canvasDescription}
            </p>
          </Link>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function WorkspacePage({
  locale,
  projects,
}: {
  locale: string;
  projects: WorkspaceProjectCardItem[];
}) {
  const copy = getHistoryCopy(locale);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] =
    useState<WorkspaceProjectCardItem | null>(null);
  const { projects: liveProjects, deleteProjects } = useWorkspaceProjects({
    locale,
    initialProjects: projects,
    enabled: true,
  });
  const search = useProjectSearch(liveProjects);
  const listed = search.projects;

  async function removeProject(project: WorkspaceProjectCardItem) {
    setDeleteTarget(project);
  }

  async function confirmRemoveProject() {
    if (!deleteTarget) return;
    await deleteProjects([deleteTarget.id]);
    setDeleteTarget(null);
    void search.refresh();
  }

  return (
    <ProductShell active="projects" locale={locale}>
      <main className="mx-auto w-full max-w-[1280px] px-5 pb-10 pt-14 sm:px-6">
        <section className="flex flex-col gap-8 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-[10px] font-semibold tracking-[0.18em] text-[var(--vh-accent)] sm:text-[11px]">
              {copy.eyebrow}
            </p>
            <h1 className="vh-product-display vh-product-page-title mt-4 max-w-3xl text-balance text-[clamp(2.25rem,4.5vw,3.25rem)] font-semibold leading-[1.1] tracking-[-0.04em] text-[var(--vh-text-1)]">
              {copy.title}
            </h1>
            <p className="mt-4 max-w-2xl text-pretty text-[14px] font-normal leading-6 text-[var(--vh-text-2)] sm:text-[15px]">
              {copy.subtitle}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
          <ProjectBundleDialog />
          <Action
            type="button"
            onClick={() => setCreateOpen(true)}
            className="inline-flex h-11 shrink-0 items-center justify-center gap-2 self-start rounded-[var(--vh-radius-sm)] bg-[var(--vh-accent)] px-5 text-[13px] font-semibold text-[var(--vh-accent-ink)] shadow-none transition hover:bg-[var(--vh-accent)] lg:self-auto"
          >
            <Plus className="size-4" />
            {copy.newProject}
          </Action>
          </div>
        </section>

        {(liveProjects.length > 0 || search.searching) && <ProjectListControls value={search.input} onChange={search.setInput} sort={search.sort} onSort={search.setSort} copy={copy} />}
        <section className="mt-8">
          {search.searching && !search.loading && listed.length === 0 ? (
            <p role="status" className="py-16 text-center text-sm text-[var(--vh-text-2)]">{copy.noMatches}</p>
          ) : listed.length > 0 ? (
            <div className="grid gap-x-4 gap-y-7 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {listed.map((project) => {
                const name = projectName(project.name, copy.untitled);
                return (
                  <article key={project.id} className="group relative min-w-0">
                    <Link
                      href={buildLocalizedProjectDetailPath({
                        locale,
                        projectId: project.id,
                        mode: project.lastWorkspaceMode,
                      })}
                      aria-label={copy.openProject(name)}
                      className="block"
                    >
                      <div className="relative aspect-[16/10] overflow-hidden rounded-[var(--vh-radius)] border border-[var(--vh-border)] bg-[var(--vh-surface)] shadow-none transition duration-300 group-hover:-translate-y-0.5 group-hover:border-[var(--vh-border)]">
                        {project.coverImageUrl ? (
                          <img
                            src={project.coverImageUrl}
                            alt=""
                            className="size-full object-cover transition duration-500 group-hover:scale-[1.025]"
                          />
                        ) : (
                          <div className="absolute inset-0 flex items-center justify-center text-[var(--vh-text-2)]">
                            <FolderClock className="size-11" strokeWidth={1.15} />
                          </div>
                        )}
                      </div>
                      <h2 className="vh-product-display mt-3 truncate px-1 text-[15px] font-semibold tracking-[-0.02em] text-[var(--vh-text-1)]">
                        {name}
                      </h2>
                    </Link>

                    <Action
                      type="button"
                      onClick={() => void removeProject(project)}
                      aria-label={copy.deleteProject}
                      className="absolute right-3 top-3 grid size-8 place-items-center rounded-full border border-[var(--vh-border)] bg-[var(--vh-control)] text-[var(--vh-text-2)] opacity-0 backdrop-blur transition hover:bg-red-500 hover:text-[var(--vh-text-1)] group-hover:opacity-100 focus-visible:opacity-100"
                    >
                      <Trash2 className="size-3.5" />
                    </Action>
                  </article>
                );
              })}
              {search.canShowMore && <div className="col-span-full flex justify-center"><Action className="vh-secondary" onClick={search.showMore}>{copy.showMore}</Action></div>}
            </div>
          ) : (
            <div className="flex min-h-[330px] flex-col items-center justify-center rounded-[var(--vh-radius)] border border-dashed border-[var(--vh-border)] bg-[var(--vh-surface)] px-6 text-center">
              <span className="grid size-14 place-items-center rounded-[var(--vh-radius-sm)] border border-[var(--vh-border)] bg-[var(--vh-surface)] text-[var(--vh-accent)] shadow-none">
                <FolderClock className="size-6" />
              </span>
              <h2 className="vh-product-display mt-5 text-[21px] font-semibold tracking-[-0.03em] text-[var(--vh-text-1)]">
                {copy.startFirst}
              </h2>
              <p className="mt-2 max-w-md text-[13px] font-normal leading-6 text-[var(--vh-text-2)]">
                {copy.emptyDescription}
              </p>
              <Action
                type="button"
                onClick={() => setCreateOpen(true)}
                className="mt-6 inline-flex h-10 items-center gap-2 rounded-[var(--vh-radius-sm)] bg-[var(--vh-accent)] px-4 text-[12px] font-semibold text-[var(--vh-accent-ink)] shadow-none transition hover:bg-[var(--vh-accent)]"
              >
                <Plus className="size-4" />
                {copy.newProject}
              </Action>
            </div>
          )}
        </section>
      </main>

      <CreateProjectDialog locale={locale}
        open={createOpen}
        onOpenChange={setCreateOpen}
        copy={copy}
      />

      <ConfirmDialog
        variant="compact"
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title={
          deleteTarget
            ? copy.deleteConfirm(
                projectName(deleteTarget.name, copy.untitled)
              )
            : ''
        }
        description={copy.deleteConfirmDescription}
        confirmLabel={copy.deleteProject}
        cancelLabel={copy.cancel}
        onConfirm={confirmRemoveProject}
      />
    </ProductShell>
  );
}
