import { createHash, randomBytes } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { getDb } from '@/core/workspace-lib/db-adapter';
import { projectAssetMembership, userAsset } from '@/config/db/schema';
import { getActiveProject } from '../projects/projects';
import { persistViralHitCommand } from '../commands/persist';
import { createCommandId } from '../commands/contracts';
import { uiCommandRequestSchema } from '../commands/schema';
import { canResolveComment, type CollaborationActor } from './access';
import { guestCollaborationRequest, ownerCollaborationRequest, type CollaborationView, type SharedProjectView } from './contract';
import { activeShareByHash, deleteComment, findComment, insertComment, insertShare, listComments, listShares, revokeShare, setCommentResolved, type StoredComment } from './store.server';

export class ShareNotFoundError extends Error {}
const hash = (token: string) => createHash('sha256').update(token).digest('hex');
const publicComment = ({ shareId: _shareId, ...view }: StoredComment) => view;

async function activeProject(projectId: string) {
  const project = await getActiveProject({ projectId });
  if (!project) throw Error('Project not found');
  return project;
}

/**
 * Owner actions from this computer. The link token is returned once, when it is made; only its hash is kept.
 * Agents may read and write comments but cannot create or revoke links.
 */
export async function changeCollaboration(projectId: string, raw: unknown, author: { kind: 'owner' | 'agent'; name: string }) {
  const request = ownerCollaborationRequest.parse(raw);
  await activeProject(projectId);
  if (author.kind === 'agent' && (request.action === 'share' || request.action === 'revoke')) throw Error('Only the project owner can create or revoke share links');
  if (request.action === 'share') {
    const token = randomBytes(24).toString('base64url');
    return { share: insertShare(projectId, request.role, hash(token), request.label ?? null), path: '/shared/' + token };
  }
  if (request.action === 'revoke') return { revoked: revokeShare(projectId, request.shareId) };
  if (request.action === 'comment') return { comment: publicComment(insertComment(projectId, { shareId: null, author: author.name, authorKind: author.kind, body: request.body, anchor: request.anchor })) };
  if (request.action === 'resolve' || request.action === 'delete') {
    if (!findComment(projectId, request.commentId)) throw Error('Comment not found');
    if (request.action === 'delete') return { deleted: deleteComment(projectId, request.commentId) };
    setCommentResolved(projectId, request.commentId, request.resolved ? author.name : null);
  }
  return readCollaboration(projectId);
}

export function readCollaboration(projectId: string): CollaborationView {
  return { shares: listShares(projectId).map(({ projectId: _projectId, ...view }) => view), comments: listComments(projectId).map(publicComment) };
}

/** Resolves a link to its project and role; unknown and revoked links look the same. */
export async function openShare(token: string) {
  const share = /^[A-Za-z0-9_-]{32}$/.test(token) ? activeShareByHash(hash(token)) : null;
  const project = share && await getActiveProject({ projectId: share.projectId });
  if (!share || !project) throw new ShareNotFoundError('This link is not active');
  const actor: CollaborationActor = { kind: 'guest', role: share.role, shareId: share.id, projectId: share.projectId };
  return { share, project, actor };
}

/** The newest rendered cut, the role and every comment: all a reviewer needs. */
export async function readSharedProject(token: string): Promise<SharedProjectView> {
  const { share, project } = await openShare(token);
  const db = await getDb();
  const [cut] = await db.select({ url: userAsset.publicUrl, durationMs: userAsset.durationMs, createdAt: projectAssetMembership.createdAt })
    .from(projectAssetMembership).innerJoin(userAsset, eq(userAsset.id, projectAssetMembership.assetId))
    .where(and(eq(projectAssetMembership.projectId, project.id), eq(projectAssetMembership.role, 'timeline_render'), eq(userAsset.type, 'video')))
    .orderBy(desc(projectAssetMembership.createdAt)).limit(1);
  return {
    project: { id: project.id, name: project.name }, role: share.role,
    cut: cut?.url ? { url: cut.url, durationMs: cut.durationMs ?? null, createdAt: new Date(cut.createdAt).getTime() } : null,
    comments: listComments(project.id).map(comment => ({ ...publicComment(comment), mine: comment.shareId === share.id })),
  };
}

/** Comments and settling from a shared link; viewers settle only what their link wrote. */
export async function changeShared(token: string, raw: unknown) {
  const { share, actor } = await openShare(token);
  const request = guestCollaborationRequest.parse(raw);
  if (request.action === 'comment') return { comment: publicComment(insertComment(share.projectId, { shareId: share.id, author: request.name, authorKind: 'guest', body: request.body, anchor: request.anchor })) };
  const target = findComment(share.projectId, request.commentId);
  if (!target) throw Error('Comment not found');
  if (!canResolveComment(actor, target)) throw Error('Viewers can settle only their own comments');
  setCommentResolved(share.projectId, request.commentId, request.resolved ? request.name : null);
  return { comments: listComments(share.projectId).map(publicComment) };
}

/** Timeline edits from a shared editor go through the same command path and revision checks as the editor. */
export async function runSharedCommand(token: string, raw: unknown) {
  const { share, actor } = await openShare(token);
  const payload = uiCommandRequestSchema.parse(raw), commandId = payload.commandId ?? createCommandId();
  return persistViralHitCommand({ projectId: share.projectId, origin: 'guest', actor, commandId, expectedRevision: payload.expectedRevision, idempotencyKey: payload.idempotencyKey ?? commandId, command: payload.command });
}
