import { spawnSync } from 'node:child_process';
import { globSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const files = [
  ...globSync('src/**/*.test.ts', { cwd: root }),
  ...globSync('src/**/*.test.tsx', { cwd: root }),
]
  .sort()
  .map((file) => join(root, file));

if (files.length === 0) {
  console.error('No test files found.');
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  ['--import', 'tsx', '--import', './scripts/test-css-loader.mjs', '--test', ...files],
  {
    cwd: root,
    stdio: 'inherit',
    // Fixture endpoint for the hosted provider; tests never contact it.
    env: {
      ...process.env,
      VIRAL_HIT_CLOUD_API_URL: 'https://api.cloud.test',
      VIRAL_HIT_CLOUD_MEDIA_HOST: 'media.cloud.test',
    },
  }
);

process.exit(result.status ?? 1);
