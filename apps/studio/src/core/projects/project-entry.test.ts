import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildProjectDetailPathWithIntent,
  buildPostCreateProjectDetailPath,
  parseProjectEntryIntent,
  serializeProjectCenterCard,
} from './project-entry';

test('keeps prompt query after creation so the workspace can resume the intent', () => {
  const path = buildPostCreateProjectDetailPath({
    locale: 'zh',
    projectId: 'project-1',
    target: 'image',
    model: 'gpt-image-2',
    prompt: 'new product hero',
    mode: 'studio',
  });

  assert.equal(
    path,
    '/zh/studio/project-1?target=image&model=gpt-image-2&prompt=new+product+hero'
  );
});

test('keeps the Japanese locale prefix in project workspace links', () => {
  const path = buildPostCreateProjectDetailPath({
    locale: 'ja',
    projectId: 'project-1',
    mode: 'editor',
  });

  assert.equal(path, '/ja/editor/project-1');
});

test('preserves a stable Canvas focus card in project links', () => {
  const path = buildProjectDetailPathWithIntent({
    projectId: 'project-1',
    mode: 'canvas',
    focus: 'card:hero',
  });

  assert.equal(path, '/canvas/project-1?focus=card%3Ahero');
  assert.equal(
    parseProjectEntryIntent(new URLSearchParams('focus=card%3Ahero')).focus,
    'card:hero'
  );
});

test('serializes the last workspace mode so project cards resume in place', () => {
  const card = serializeProjectCenterCard({
    id: 'project-1',
    name: 'Campaign launch',
    lastWorkspaceMode: 'studio',
    updatedAt: new Date('2026-08-15T10:00:00.000Z'),
  });

  assert.equal(card.lastWorkspaceMode, 'studio');
});

test('Korean project creation preserves the locale and prompt', () => {
  assert.equal(buildPostCreateProjectDetailPath({ locale: 'ko', projectId: 'project-1', mode: 'studio', prompt: '봄날의 정원' }), '/ko/studio/project-1?prompt=%EB%B4%84%EB%82%A0%EC%9D%98+%EC%A0%95%EC%9B%90');
});
