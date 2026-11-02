import type { ShareRole } from './contract';

/** Who sent a request. This computer's UI, MCP and CLI act for the owner; a shared link acts as a guest. */
export type CollaborationActor =
  | { kind: 'owner' }
  | { kind: 'guest'; role: ShareRole; shareId: string; projectId: string };

const GUEST_COMMANDS: Record<ShareRole, readonly string[]> = { viewer: [], editor: ['editor.apply', 'editor.validate'] };

/** Why the actor may not run a command on a project, or null when it may. */
export function commandDenial(actor: CollaborationActor, projectId: string, commandType: string): string | null {
  if (actor.kind === 'owner') return null;
  if (actor.projectId !== projectId) return 'This link belongs to another project.';
  if (GUEST_COMMANDS[actor.role].includes(commandType)) return null;
  return actor.role === 'viewer' ? 'Viewers can watch and comment but cannot edit.' : 'A shared editor can change the timeline only.';
}

/** Owners and shared editors settle any comment; a viewer settles only comments sent from the same link. */
export function canResolveComment(actor: CollaborationActor, comment: { shareId: string | null }) {
  return actor.kind === 'owner' || actor.role === 'editor' || comment.shareId === actor.shareId;
}
