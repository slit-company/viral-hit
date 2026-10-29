import { useState } from 'react';
import { Action } from '@/components/base/action';
import { Link } from '@/core/i18n/navigation';
import type { ProjectGenerationItem } from '@/core/effects/project-generations';
import { fetchRecentAssets } from '@/core/workspace-lib/app/workspace-client-api';
import { addProjectAssetToTimeline } from '@/core/editor/timeline-client';
export function StudioResultActions({
  item,
  projectId,
  onReuse,
}: {
  item: ProjectGenerationItem;
  projectId: string;
  onReuse: () => void;
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
          '이 결과의 프로젝트 파일을 찾지 못했어요. 프로젝트 자료에서 확인해주세요.',
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
          : '편집기에 추가하지 못했어요.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-2 border-b border-[var(--vh-border)] p-4">
      <div className="flex flex-wrap gap-2">
        <Action className="vh-secondary" onClick={onReuse}>
          이 설정 다시 쓰기
        </Action>
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
                  ? '추가하는 중…'
                  : added
                    ? '편집기에 추가됨'
                    : '편집기에 추가'}
              </Action>
              <Link
                href={'/editor/' + projectId}
                className="inline-flex items-center text-xs font-medium underline underline-offset-4"
              >
                편집기 열기
              </Link>
              <a
                href={item.resultUrl}
                download
                className="inline-flex items-center text-xs underline underline-offset-4"
              >
                다운로드
              </a>
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
          타임라인에 추가했어요. 편집기에서 이어서 작업하세요.
        </p>
      )}
    </div>
  );
}
