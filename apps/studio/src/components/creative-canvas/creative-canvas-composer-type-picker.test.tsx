import assert from 'node:assert/strict';
import test from 'node:test';

import { renderToStaticMarkup } from 'react-dom/server';

import type { CanvasLabels } from './creative-canvas-front-layer-context';
import { CreativeCanvasComposerTypePicker } from './creative-canvas-composer-type-picker';

const labels = {
  imageTitle: 'Image',
  videoTitle: 'Video',
  imageModeLabel: 'Image',
  videoModeLabel: 'Video',
  analysisModeLabel: 'Analyze',
  typeLabel: 'Generation type',
} as CanvasLabels;

test('renders the selected generation type as a compact composer field', () => {
  const html = renderToStaticMarkup(
    <CreativeCanvasComposerTypePicker
      activeDraftId="draft-1"
      isDraftBusy={false}
      isOpen={false}
      labels={labels}
      onDraftTaskTypeChange={() => {}}
      onOpenChange={() => {}}
      selectedType="image"
    />
  );

  assert.match(html, />Image</);
  assert.match(html, /rounded-full/);
  assert.match(html, /aria-label="Generation type"/);
  assert.doesNotMatch(html, />Video</);
});

test('open type picker keeps Canvas aligned with Studio image, video, and analysis modes', () => {
  const html = renderToStaticMarkup(
    <CreativeCanvasComposerTypePicker
      activeDraftId="draft-1"
      isDraftBusy={false}
      isOpen
      labels={labels}
      onDraftTaskTypeChange={() => {}}
      onOpenChange={() => {}}
      selectedType="video"
    />
  );

  assert.match(html, />Image</);
  assert.match(html, />Video</);
  assert.match(html, />Analyze</);
  assert.match(html, /text-\[var\(--vh-accent\)\]/);
});
