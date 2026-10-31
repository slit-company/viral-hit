import { m as uiMessages } from '@/paraglide/messages.js';
import { useState } from 'react';
import { Action } from '@/components/base/action';
import { Link } from '@/core/i18n/navigation';
import type { ProjectGenerationItem } from '@/core/effects/project-generations';
import { fetchRecentAssets } from '@/core/workspace-lib/app/workspace-client-api';
import { addProjectAssetToTimeline } from '@/core/editor/timeline-client';
import type { StudioToolId } from '@/core/studio/tools';
import { continueTools } from './use-studio-continue';

const continueLabel = (tool: StudioToolId) =>
  tool === 'image-edit' ? uiMessages["studio.tools.continue_edit_image"]()
    : tool === 'video-generate' ? uiMessages["studio.tools.continue_animate"]()
      : uiMessages["studio.tools.continue_edit_video"]();

export function StudioResultActions({
  item,
  projectId,
  onReuse,
  onContinue,
}: {
  item: ProjectGenerationItem;
  projectId: string;
  onReuse: () => void;
  onContinue?: (tool: StudioToolId) => void;
}) {
  const [busy, setBusy] = useState(false),
    [added, setAdded] = useState(false),
    [error, setError] = useState('');
  async function edit() {
    if (busy || added || item.mediaType === 'analysis') return;
    setBusy(true);
    setError('');
    try {
      const assets = await fetchRecentAssets(projectId);
      const asset = [...assets.images, ...assets.videos, ...assets.audios].find(
        (candidate) => candidate.publicUrl === item.resultUrl,
      );
      if (!asset)
        throw Error(
          uiMessages["studio.tools.could_not_find_the_project_file_for_this_result_check_your_project_media"](),
        );
      await addProjectAssetToTimeline({
        projectId,
        asset,
        mediaType: item.mediaType,
      });
      setAdded(true);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : uiMessages["studio.tools.could_not_add_this_result_to_the_editor"](),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-2 border-b border-[var(--vh-border)] p-4">
      {onContinue && continueTools(item).length > 0 && (
        <div role="group" aria-label={uiMessages["studio.tools.continue_with_result"]()} className="flex flex-wrap gap-2">
          {continueTools(item).map(tool => <Action key={tool} className="vh-secondary" onClick={() => onContinue(tool)}>{continueLabel(tool)}</Action>)}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Action className="vh-secondary" onClick={onReuse}>
          {uiMessages["studio.tools.use_these_settings_again"]()}</Action>
        {item.status === 'succeeded' &&
          item.resultUrl &&
          item.mediaType !== 'analysis' && (
            <>
              <Action
                className="vh-primary"
                disabled={busy || added}
                onClick={() => void edit()}
              >
                {busy
                  ? uiMessages["studio.tools.adding"]()
                  : added
                    ? uiMessages["studio.tools.added_to_editor"]()
                    : uiMessages["studio.tools.add_to_editor"]()}
              </Action>
              <Link
                href={'/editor/' + projectId}
                className="inline-flex items-center text-xs font-medium underline underline-offset-4"
              >
                {uiMessages["studio.tools.open_editor"]()}</Link>
              <a
                href={item.resultUrl}
                download
                className="inline-flex items-center text-xs underline underline-offset-4"
              >
                {uiMessages["studio.tools.download"]()}</a>
            </>
          )}
      </div>
      {error && (
        <p role="alert" className="text-xs text-red-700">
          {error}
        </p>
      )}
      {added && (
        <p role="status" className="text-xs text-[var(--vh-text-2)]">
          {uiMessages["studio.tools.added_to_the_timeline_continue_in_the_editor"]()}</p>
      )}
    </div>
  );
}
