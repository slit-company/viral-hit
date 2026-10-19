import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('keeps the sidebar outside the React Flow Suspense fallback', () => {
  const source = readFileSync(
    new URL('./creative-canvas-shell.tsx', import.meta.url),
    'utf8'
  );

  const suspenseStart = source.indexOf(
    '<Suspense fallback={<CreativeCanvasLoading />}>'
  );
  const suspenseEnd = source.indexOf('</Suspense>', suspenseStart);
  const sidebarStart = source.indexOf('<CreativeCanvasSidebar');

  assert.notEqual(suspenseStart, -1);
  assert.notEqual(suspenseEnd, -1);
  assert.notEqual(sidebarStart, -1);
  assert.ok(
    sidebarStart > suspenseEnd,
    'CreativeCanvasSidebar should render outside the React Flow Suspense boundary'
  );
});

test('keeps non-critical canvas overlays out of the studio shell static imports', () => {
  const source = readFileSync(
    new URL('./creative-canvas-shell.tsx', import.meta.url),
    'utf8'
  );

  assert.doesNotMatch(
    source,
    /import\s+\{\s*CreativeCanvasContextToolbar\s*\}\s+from\s+['"]\.\/creative-canvas-context-toolbar['"]/
  );
  assert.doesNotMatch(
    source,
    /import\s+\{\s*CreativeCanvasMediaPreviewOverlay/
  );
  assert.doesNotMatch(
    source,
    /import\s+\{\s*CreativeCanvasStatusPill\s*\}\s+from\s+['"]\.\/creative-canvas-status-pill['"]/
  );

  assert.match(
    source,
    /const CreativeCanvasContextToolbar = lazy\(\(\) =>\s+import\(['"]\.\/creative-canvas-context-toolbar['"]\)/
  );
  assert.match(
    source,
    /const CreativeCanvasMediaPreviewOverlay = lazy\(\(\) =>\s+import\(['"]\.\/creative-canvas-media-preview-overlay['"]\)/
  );
  assert.match(
    source,
    /const CreativeCanvasStatusPill = lazy\(\(\) =>\s+import\(['"]\.\/creative-canvas-status-pill['"]\)/
  );
});
