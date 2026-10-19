import { ProductPageShell } from '@/components/app/product-page-shell';
import { ProjectAssetsWorkspace } from '@/components/app/project-assets-workspace';
import { StudioWorkspace } from '@/components/studio/studio-workspace';
import { CreativeCanvasShell } from '@/components/creative-canvas/creative-canvas-shell';
import { VideoEditorWorkspace } from '@/components/editor/video-editor-workspace';
import type { loadWorkspaceProjectRoute } from '@/core/projects/workspace-project-route-loader';

type WorkspaceProjectRouteData = Awaited<
  ReturnType<typeof loadWorkspaceProjectRoute>
>;

export function WorkspaceProjectRoutePage({
  data,
}: {
  data: WorkspaceProjectRouteData;
}) {
  return (
    <ProductPageShell
      workspaceName={data.project.name}
      projectId={data.project.id}
      workspaceMode={data.workspaceMode}
    >
      {data.workspaceMode === 'studio' ? (
        <StudioWorkspace
          key={data.project.id}
          projectId={data.project.id}
          initialTarget={data.target}
          initialModelId={data.modelId}
          initialPrompt={data.prompt}
        />
      ) : data.workspaceMode === 'assets' ? (
        <ProjectAssetsWorkspace key={data.project.id} projectId={data.project.id} />
      ) : data.workspaceMode === 'editor' ? (
        <VideoEditorWorkspace
          key={data.project.id}
          projectId={data.project.id}
          projectName={data.project.name}
        />
      ) : (
        <CreativeCanvasShell
          key={data.project.id}
          projectId={data.project.id}
          projectPath={data.projectPath}
          initialProjectSnapshot={data.snapshot}
          initialProjectSnapshotVersion={data.snapshotVersion}
          initialTarget={data.target}
          initialModelId={data.modelId}
          initialPrompt={data.prompt}
          initialFocusCardId={data.focusCardId}
        />
      )}
    </ProductPageShell>
  );
}
