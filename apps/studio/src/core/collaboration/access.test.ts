import test from 'node:test';
import assert from 'node:assert/strict';
import { canResolveComment, commandDenial, type CollaborationActor } from './access';

const viewer: CollaborationActor = { kind: 'guest', role: 'viewer', shareId: 'link-a', projectId: 'p1' };
const editor: CollaborationActor = { ...viewer, role: 'editor', shareId: 'link-b' };

test('share links run only what their role allows, on their own project', () => {
  assert.equal(commandDenial({ kind: 'owner' }, 'p1', 'editor.replace_document'), null);
  assert.match(commandDenial(viewer, 'p1', 'editor.apply') ?? '', /Viewers/);
  assert.equal(commandDenial(editor, 'p1', 'editor.apply'), null);
  assert.equal(commandDenial(editor, 'p1', 'editor.validate'), null);
  for (const type of ['canvas.apply', 'editor.replace_document']) assert.match(commandDenial(editor, 'p1', type) ?? '', /timeline only/);
  assert.match(commandDenial(editor, 'p2', 'editor.apply') ?? '', /another project/);
});

test('viewers settle only comments from their own link; editors and owners settle any', () => {
  assert.equal(canResolveComment(viewer, { shareId: 'link-a' }), true);
  assert.equal(canResolveComment(viewer, { shareId: 'link-b' }), false);
  assert.equal(canResolveComment(viewer, { shareId: null }), false);
  assert.equal(canResolveComment(editor, { shareId: null }), true);
  assert.equal(canResolveComment({ kind: 'owner' }, { shareId: 'link-a' }), true);
});
