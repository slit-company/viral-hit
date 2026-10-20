import { useCallback, useEffect, type RefObject } from 'react';
import { toast } from 'sonner';
import type { CanvasCard } from '@/core/creative-canvas/canvas-types';
import {
  PROJECT_ASSET_DRAG_MIME,
  PROJECT_ASSET_INSERT_EVENT,
  getProjectAssetCardSize,
  isProjectAssetTransferType,
  parseProjectAssetTransfer,
  type ProjectAssetInsertDetail,
  type ProjectAssetTransfer,
} from '@/core/creative-canvas/project-asset-transfer';
import type { useTranslations } from '@/core/workspace-lib/shims/next-intl';

type Point = { x: number; y: number };
type InsertProjectAssetCard = (input: {
  assetId: string;
  type: 'image' | 'video' | 'audio';
  url: string;
  name: string;
  kind: 'asset';
  activateOnInsert: boolean;
  size: { w: number; h: number };
  durationSec: number | null;
  audioRole?: CanvasCard['audioRole'];
  frame?: { x: number; y: number; w: number; h: number };
}) => string | null;

/**
 * Places project library assets on the canvas from the library's Add action or a drag and drop.
 * Returns the insert function for callers that already hold a project asset.
 */
export function useProjectAssetCanvasInsert({
  projectId,
  editorRef,
  insertAssetCard,
  projectAssetsT,
}: {
  projectId: string;
  editorRef: RefObject<{ screenToPage: (point: Point) => Point } | null>;
  insertAssetCard: InsertProjectAssetCard;
  projectAssetsT: ReturnType<typeof useTranslations>;
}) {
  const insertProjectAsset = useCallback(
    (
      asset: ProjectAssetTransfer,
      clientPoint?: { x: number; y: number }
    ) => {
      if (asset.projectId !== projectId) return;

      const size = getProjectAssetCardSize(asset);
      const pagePoint = clientPoint
        ? editorRef.current?.screenToPage(clientPoint)
        : null;
      const insertedShapeId = insertAssetCard({
        assetId: asset.id,
        type: asset.mediaType,
        url: asset.publicUrl,
        name:
          asset.filename?.trim() ||
          projectAssetsT(
            asset.mediaType === 'image'
              ? 'imageName'
              : asset.mediaType === 'audio'
                ? 'audioName'
                : 'videoName'
          ),
        kind: 'asset',
        activateOnInsert: true,
        size,
        durationSec:
          typeof asset.durationMs === 'number' ? asset.durationMs / 1000 : null,
        audioRole: asset.mediaType === 'audio' ? 'music' : undefined,
        ...(pagePoint
          ? {
              frame: {
                x: pagePoint.x - size.w / 2,
                y: pagePoint.y - size.h / 2,
                w: size.w,
                h: size.h,
              },
            }
          : {}),
      });

      if (insertedShapeId) {
        toast.success(projectAssetsT('addedToCanvas'));
      }
    },
    [editorRef, insertAssetCard, projectAssetsT, projectId]
  );

  useEffect(() => {
    const handleInsertEvent = (event: Event) => {
      const detail = (event as CustomEvent<ProjectAssetInsertDetail>).detail;
      if (!detail?.asset) return;
      insertProjectAsset(detail.asset, detail.clientPoint);
    };

    const handleDragOver = (event: DragEvent) => {
      if (
        !event.dataTransfer ||
        !isProjectAssetTransferType(Array.from(event.dataTransfer.types))
      ) {
        return;
      }
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    };

    const handleDrop = (event: DragEvent) => {
      const transferValue = event.dataTransfer?.getData(
        PROJECT_ASSET_DRAG_MIME
      );
      if (!transferValue) return;

      const asset = parseProjectAssetTransfer(transferValue);
      if (!asset || asset.projectId !== projectId) return;

      event.preventDefault();
      event.stopPropagation();
      insertProjectAsset(asset, { x: event.clientX, y: event.clientY });
    };

    window.addEventListener(PROJECT_ASSET_INSERT_EVENT, handleInsertEvent);
    window.addEventListener('dragover', handleDragOver, true);
    window.addEventListener('drop', handleDrop, true);
    return () => {
      window.removeEventListener(PROJECT_ASSET_INSERT_EVENT, handleInsertEvent);
      window.removeEventListener('dragover', handleDragOver, true);
      window.removeEventListener('drop', handleDrop, true);
    };
  }, [insertProjectAsset, projectId]);

  return insertProjectAsset;
}
