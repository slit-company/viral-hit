import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const studioSource = readFileSync(
  new URL('./studio-workspace.tsx', import.meta.url),
  'utf8'
);
const composerSource = readFileSync(
  new URL('./studio-composer.tsx', import.meta.url),
  'utf8'
);
const feedSource = readFileSync(
  new URL('./studio-generation-feed.tsx', import.meta.url),
  'utf8'
);
const startHereSource = readFileSync(
  new URL('./studio-start-here.tsx', import.meta.url),
  'utf8'
);

test('studio uses the shared creative surface without a persistent media sidebar', () => {
  assert.match(studioSource, /--vh-bg/);
  assert.doesNotMatch(studioSource, /Powered by Cloud API/);
  assert.doesNotMatch(studioSource, /w-14 shrink-0 flex-col/);
});

test('studio uses tool-first production panels and the existing project generation feed', () => {
  assert.match(studioSource, /StudioToolComposer/);
  assert.match(studioSource, /StudioGenerationFeed/);
  assert.match(studioSource, /StudioToolGuide/);
  assert.match(studioSource, /StudioToolNavigation/);
  assert.match(studioSource, /StudioToolSelection/);
  assert.match(composerSource, /max-w-\[1138px\]/);
  assert.match(composerSource, /uiMessages\["ui.studio.media_type"\]/);
  assert.match(composerSource, /WorkspaceSelect/);
  assert.match(composerSource, /CreativeCanvasComposerParameterPicker/);
  assert.match(composerSource, /truncatePromptToMaxChars/);
  assert.match(composerSource, /labels\.generateLabel/);
  assert.doesNotMatch(composerSource, /RotateCw/);
  assert.match(feedSource, /max-w-\[1138px\]/);
  assert.match(feedSource, /formatStudioHistoryDateTime/);
  // Results are a Higgsfield-style grid of square tiles with the prompt under each tile.
  assert.match(feedSource, /aspect-square/);
  assert.match(feedSource, /object-cover/);
  assert.match(feedSource, /item\.prompt/);
  assert.match(studioSource, /studio.tools.creation_settings/);
  assert.match(studioSource, /studio.tools.project_results/);
  assert.match(startHereSource, /ui.studio.create_here/);
  assert.match(studioSource, /fetchProjectGenerations/);
  assert.match(composerSource, /value: 'analysis'/);
  assert.doesNotMatch(composerSource, /workflowLabel/);
  assert.doesNotMatch(composerSource, /tokenBudget/);
  assert.doesNotMatch(composerSource, /fileRequired/);
  assert.doesNotMatch(studioSource, /analysisOutputTokens/);
  assert.match(feedSource, /selected\.resultText/);
});

test('studio model selector follows the selected model name width', () => {
  assert.match(
    composerSource,
    /uiMessages\["ui.studio.model"\][\s\S]*?triggerClassName="w-fit max-w-full"/
  );
});
