import { ProjectAssetsLibrary } from '@/components/app/project-assets-dialog';
import { ProjectCharacters } from '@/components/characters/project-characters';
import { useQueryClient } from '@tanstack/react-query';
import { invalidateWorkspaceAfterAssetMutation } from '@/core/workspace-lib/app/workspace-query-invalidation';
import { useTranslations } from '@/core/workspace-lib/shims/next-intl';

export function ProjectAssetsWorkspace({ projectId }: { projectId: string }) {
  const t = useTranslations('AppShell.header.projectAssets');
  const queryClient = useQueryClient();

  return (
    <section className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-[var(--vh-bg)] text-[var(--vh-text-1)]">
      <div className="pointer-events-none absolute inset-0 bg-[var(--vh-surface)]" />
      <div className="relative min-h-0 flex-1 overflow-y-auto px-4 py-8 sm:px-6">
        <div className="mx-auto w-full max-w-[1138px]">
          <h1 className="vh-product-display text-[1.35rem] font-semibold tracking-[-0.03em] text-[var(--vh-text-1)]">
            {t('title')}
          </h1>
          <p className="mt-2 text-[13px] leading-6 text-[var(--vh-text-3)]">
            {t('description')}
          </p>
          <div className="mt-8">
            <ProjectCharacters projectId={projectId} onAdded={() => void invalidateWorkspaceAfterAssetMutation(queryClient)} />
          </div>
          <div className="mt-8">
            <ProjectAssetsLibrary projectId={projectId} />
          </div>
        </div>
      </div>
    </section>
  );
}
