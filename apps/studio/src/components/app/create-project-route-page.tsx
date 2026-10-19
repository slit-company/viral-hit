import { useState } from 'react';
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
  workspaceMode: WorkspaceMode;
  projectName: string;
};

function getCopy(locale: string) {
  const messageLocale = normalizeLocale(locale);
  return {
    title: m['Cloud API.project.newTitle']({}, { locale: messageLocale }),
    description: m['Cloud API.project.newDescription'](
      {},
      { locale: messageLocale }
    ),
    errorTitle: m['Cloud API.project.newErrorTitle'](
      {},
      { locale: messageLocale }
    ),
    retry: m['Cloud API.project.retry']({}, { locale: messageLocale }),
    startTitle: m['Cloud API.project.startTitle']({}, { locale: messageLocale }),
    startDescription: m['Cloud API.project.startDescription'](
      {},
      { locale: messageLocale }
    ),
    startStudio: m['Cloud API.project.startStudio'](
      {},
      { locale: messageLocale }
    ),
    startCanvas: m['Cloud API.project.startCanvas'](
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
  const { locale, target, model, prompt, projectName } = data;
  const copy = getCopy(locale);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createProject(workspaceMode: WorkspaceMode) {
    if (creating) return;
    setCreating(true);
    setError(null);

    try {
      const payload = await apiJsonPost<CreateProjectResponse>(
        '/api/app/projects',
        { name: projectName, workspaceMode }
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
          mode: workspaceMode,
        })
      );
    } catch (createError) {
      setError(
        createError instanceof Error ? createError.message : copy.errorTitle
      );
      setCreating(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--vh-bg)] px-6 py-16 text-[var(--vh-text-1)]">
      <section className="w-full max-w-[520px] rounded-[var(--vh-radius)] border border-[var(--vh-border)] bg-[var(--vh-surface)] px-8 py-9 text-center shadow-none">
        {error ? (
          <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-red-500/10 text-red-400">
            <AlertCircleIcon className="size-6" />
          </div>
        ) : creating ? (
          <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-[rgba(255,122,51,0.12)] text-[var(--vh-accent)]">
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
