import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { inspectArchitecture, violations } from './check-architecture.mjs';

function inspect(t, files) {
  const workspace = mkdtempSync(join(tmpdir(), 'viral-hit-architecture-'));
  t.after(() => rmSync(workspace, { recursive: true, force: true }));
  for (const [name, source] of Object.entries(files)) {
    const path = join(workspace, 'src', name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, source);
  }
  return inspectArchitecture(workspace);
}

test('browser imports cannot reach server dependencies through a barrel', t => {
  const report = inspect(t, {
    'components/project.tsx': "import { catalog } from '@/core/catalog';",
    'core/catalog/index.ts': "export { catalog } from '../store';",
    'core/store.ts': "import { createClient } from '@libsql/client'; export const catalog = [];",
  });
  assert.equal(report.findings.length, 1);
  assert.match(report.findings[0], /browser-server:.*project.tsx.*catalog\/index.ts.*store.ts.*@libsql\/client/);
});

test('type-only imports and exports do not pull server code into the browser', t => {
  const report = inspect(t, {
    'components/project.tsx': "import type { A } from '@/core/a'; import { type B } from '@/core/b'; export type { A } from '@/core/a'; export { type B } from '@/core/b';",
    'core/a.ts': "import fs from 'node:fs'; export type A = string;",
    'core/b.ts': "import db from 'drizzle-orm'; export type B = number;",
  });
  assert.deepEqual(report.findings, []);
  assert.equal(report.browserModules, 1);
});

test('mixed imports, dynamic imports, require and builtin lookup are runtime edges', t => {
  const report = inspect(t, {
    'components/project.tsx': "import { type A, value } from '@/core/a'; import('node:fs'); require('path'); process.getBuiltinModule('crypto');",
    'core/a.ts': "import sdk from '@comfyorg/sdk'; export type A = string; export const value = 1;",
  });
  for (const name of ['node:fs', 'path', 'crypto', '@comfyorg/sdk']) {
    assert.ok(report.findings.some(finding => finding.endsWith(` -> ${name}`)), name);
  }
});

test('server-only module names remain forbidden even without a known dependency', t => {
  const report = inspect(t, {
    'components/project.tsx': "import { value } from '@/core/accounts.server';",
    'core/accounts.server.ts': 'export const value = process.env.ACCOUNT;',
  });
  assert.match(report.findings[0], /^browser-server-module:.*accounts.server.ts$/);
});

test('domain direction, shared UI ownership and research dependencies are enforced', t => {
  const report = inspect(t, {
    'components/ui/button.tsx': "import '@/core/domain';",
    'core/domain.ts': "import '@/routes/page'; import '../../research/upstream/example';",
    'routes/page.tsx': 'export const Page = () => null;',
  });
  assert.ok(report.findings.some(value => value.startsWith('core-direction:')));
  assert.ok(report.findings.some(value => value.startsWith('shared-ui-direction:')));
  assert.ok(report.findings.some(value => value.startsWith('research-import:')));
});

test('all edges in runtime cycles fail the empty cycle baseline', t => {
  const report = inspect(t, {
    'core/a.ts': "import './b';",
    'core/b.ts': "export * from './c';",
    'core/c.ts': "import './a';",
  });
  assert.equal(report.cycles.length, 3);
  assert.equal(violations(report, { cycles: [], oversized: {} }).length, 3);
});

test('size allowances apply only to the exact existing path and cannot grow', t => {
  const report = inspect(t, {
    'core/existing.ts': '\n' + '// existing\n'.repeat(401),
    'core/new.ts': '// new\n'.repeat(401),
    'core/small.ts': '// small\n'.repeat(400),
    'core/ignored.test.ts': '// fixture\n'.repeat(500),
  });
  const baseline = { cycles: [], oversized: { 'src/core/existing.ts': 401 } };
  assert.deepEqual(violations(report, baseline), ['module-size:src/core/new.ts:401>400']);
  baseline.oversized['src/core/existing.ts'] = 400;
  assert.equal(violations(report, baseline).length, 2);
  assert.equal(report.modules, 3);
});
