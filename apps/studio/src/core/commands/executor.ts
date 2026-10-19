import { diagnoseTimeline } from '@/core/editor/timeline-diagnostics';
import {
  createTimelineDocument,
  type TimelineDocument,
} from '@/core/editor/timeline-document';
import type { ProjectSnapshotDocument } from '@/core/projects/project-snapshot';

import {
  applyCanvasOperations,
  type CanvasOperation,
} from './canvas-commands';
import {
  applyEditorOperations,
  invalidateTimelineRenderIfSourceChanged,
  type EditorOperation,
} from './editor-commands';
import {
  ViralHitCommandError,
  createCommandFailure,
  createCommandSuccess,
  type ViralHitCommandEnvelope,
  type ViralHitCommandResult,
} from './contracts';

export type ViralHitCommand =
  | { type: 'canvas.apply'; operations: CanvasOperation[] }
  | { type: 'editor.apply'; operations: EditorOperation[] }
  | { type: 'editor.replace_document'; document: TimelineDocument }
  | { type: 'editor.validate' };

export type ViralHitCommandDocuments = {
  canvas?: ProjectSnapshotDocument;
  timeline?: TimelineDocument | null;
};

export type ViralHitCommandData = ViralHitCommandDocuments & {
  diagnostics?: ReturnType<typeof diagnoseTimeline>;
};

export function executeViralHitCommand({
  envelope,
  documents,
}: {
  envelope: ViralHitCommandEnvelope<ViralHitCommand>;
  documents: ViralHitCommandDocuments;
}): ViralHitCommandResult<ViralHitCommandData> {
  const { commandId, projectId, origin, command } = envelope;

  try {
    if (command.type === 'canvas.apply') {
      if (!documents.canvas) {
        throw new ViralHitCommandError(
          'NOT_FOUND',
          'Canvas document was not found.'
        );
      }
      const applied = applyCanvasOperations(documents.canvas, command.operations);
      return createCommandSuccess({
        commandId,
        projectId,
        origin,
        changedIds: applied.changedIds,
        data: { canvas: applied.document },
      });
    }

    if (command.type === 'editor.apply') {
      const source =
        documents.timeline ??
        createTimelineDocument({
          projectId,
          name: 'Timeline 1',
        });
      const applied = applyEditorOperations(source, command.operations);
      return createCommandSuccess({
        commandId,
        projectId,
        origin,
        changedIds: applied.changedIds,
        data: { timeline: applied.document },
      });
    }

    if (command.type === 'editor.replace_document') {
      const document = documents.timeline
        ? invalidateTimelineRenderIfSourceChanged({
            previous: documents.timeline,
            next: command.document,
          })
        : command.document;
      return createCommandSuccess({
        commandId,
        projectId,
        origin,
        changedIds: [document.id],
        data: { timeline: document },
      });
    }

    if (!documents.timeline) {
      throw new ViralHitCommandError(
        'NOT_FOUND',
        'Timeline document was not found.'
      );
    }
    return createCommandSuccess({
      commandId,
      projectId,
      origin,
      changedIds: [documents.timeline.id],
      data: {
        timeline: documents.timeline,
        diagnostics: diagnoseTimeline(documents.timeline),
      },
    });
  } catch (error) {
    if (error instanceof ViralHitCommandError) {
      return createCommandFailure({
        commandId,
        projectId,
        origin,
        code: error.code,
        message: error.message,
      });
    }
    return createCommandFailure({
      commandId,
      projectId,
      origin,
      code: 'COMMAND_FAILED',
      message:
        error instanceof Error ? error.message : 'The command could not be applied.',
    });
  }
}
