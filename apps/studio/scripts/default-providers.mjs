// Loads the providers built by `pnpm providers` unless the operator chose another folder.
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const bundled = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'providers');
if (!process.env.VIRAL_HIT_PROVIDERS_DIR?.trim() && existsSync(bundled)) process.env.VIRAL_HIT_PROVIDERS_DIR = bundled;
