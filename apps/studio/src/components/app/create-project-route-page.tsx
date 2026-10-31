import { useEffect, useRef, useState } from 'react';
import { AlertCircleIcon, Loader2Icon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { appConfig } from '@/config';
import { normalizeLocale } from '@/config/locale';
import type { WorkspaceMode } from '@/config/workspace-modes';
import { buildPostCreateProjectDetailPath } from '@/core/projects/project-entry';
import { apiJsonPost } from '@/lib/api-client';
import { m } from '@/paraglide/messages.js';

type CreateProjectResponse = {
  id?: string;
  name?: string;
  error?: string;
};

export type CreateProjectRouteData = {
  locale: string;
  target: string | null;
  model: string | null;
  prompt: string | null;
  recipe: string | null;
  workspaceMode: WorkspaceMode;
  projectName: string;
};

function getCopy(locale: string) {
  const messageLocale = normalizeLocale(locale);
  return {
    title: m['Projects.project.newTitle']({}, { locale: messageLocale }),
    description: m['Projects.project.newDescription'](
      {},
      { locale: messageLocale }
    ),
    errorTitle: m['Projects.project.newErrorTitle'](
      {},
      { locale: messageLocale }
    ),
    retry: m['Projects.project.retry']({}, { locale: messageLocale }),
    startTitle: m['Projects.project.startTitle']({}, { locale: messageLocale }),
    startDescription: m['Projects.project.startDescription'](
      {},
      { locale: messageLocale }
    ),
    startStudio: m['Projects.project.startStudio'](
      {},
      { locale: messageLocale }
    ),
    startCanvas: m['Projects.project.startCanvas'](
      {},
      { locale: messageLocale }
    ),
  };
}

export function CreateProjectRoutePage({
  data,
}: {
  data: CreateProjectRouteData;
}) {
  const { locale, target, model, prompt, recipe, projectName, workspaceMode } = data;
  const copy = getCopy(locale);
  // A submitted prompt or recipe already says what to make, so start right away.
  // A bare visit still asks, because loading this page alone must not create a project.
  const hasIntent = Boolean(prompt?.trim() || recipe);
  const [creating, setCreating] = useState(hasIntent);
  const [error, setError] = useState<string | null>(null);
  const autoStarted = useRef(false);

  async function createProject(mode: WorkspaceMode, automatic = false) {
    if (creating && !automatic) return;
    setCreating(true);
    setError(null);

    try {
      const payload = await apiJsonPost<CreateProjectResponse>(
        '/api/app/projects',
        { name: projectName, workspaceMode: mode }
      );

      if (!payload?.id) {
        throw new Error(payload?.error || copy.errorTitle);
      }

      window.location.replace(
        buildPostCreateProjectDetailPath({
          locale,
          projectId: payload.id,
          target: target ?? undefined,
          model: model ?? undefined,
          prompt: prompt ?? undefined,
          recipe: recipe ?? undefined,
          mode,
        })
      );
    } catch (createError) {
      setError(
        createError instanceof Error ? createError.message : copy.errorTitle
      );
      setCreating(false);
    }
  }

  useEffect(() => {
    if (!hasIntent || autoStarted.current) return;
    autoStarted.current = true;
    void createProject(workspaceMode, true);
    // Runs once per page load; createProject reads the loader data captured above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--vh-bg)] px-6 py-16 text-[var(--vh-text-1)]">
      <section className="w-full max-w-[520px] rounded-[var(--vh-radius)] border border-[var(--vh-border)] bg-[var(--vh-surface)] px-8 py-9 text-center shadow-none">
        {error ? (
          <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-red-500/10 text-red-400">
            <AlertCircleIcon className="size-6" />
          </div>
        ) : creating ? (
          <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-[var(--vh-control)] text-[var(--vh-text-1)]">
            <Loader2Icon className="size-6 animate-spin" />
          </div>
        ) : (
          <img
            src={appConfig.app_logo}
            alt={appConfig.app_name}
            className="mx-auto size-12 rounded-[14px] object-contain"
          />
        )}

        <h1 className="vh-product-display mt-5 text-[28px] font-semibold tracking-[-0.045em]">
          {error ? copy.errorTitle : creating ? copy.title : copy.startTitle}
        </h1>
        <p className="mt-3 text-[15px] leading-7 text-[var(--vh-text-2)]">
          {error || (creating ? copy.description : copy.startDescription)}
        </p>

        {!creating ? (
          <div className="mt-7 flex flex-col gap-2 sm:flex-row sm:justify-center">
            {error ? (
              <Button
                type="button"
                className="h-11 rounded-[var(--vh-radius-sm)] bg-[var(--vh-accent)] px-5 text-[var(--vh-accent-ink)] hover:bg-[var(--vh-accent-hover)]"
                onClick={() => void createProject('studio')}
              >
                {copy.retry}
              </Button>
            ) : (
              <>
                <Button
                  type="button"
                  className="h-11 rounded-[var(--vh-radius-sm)] bg-[var(--vh-accent)] px-5 text-[var(--vh-accent-ink)] hover:bg-[var(--vh-accent-hover)]"
                  onClick={() => void createProject('studio')}
                >
                  {copy.startStudio}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 rounded-[16px] border-[var(--vh-border)] bg-transparent px-5 text-[var(--vh-text-1)] hover:bg-[var(--vh-control)]"
                  onClick={() => void createProject('canvas')}
                >
                  {copy.startCanvas}
                </Button>
              </>
            )}
          </div>
        ) : null}
      </section>
    </main>
  );
}
