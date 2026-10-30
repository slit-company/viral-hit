import './default-providers.mjs';
import { extensionDiagnostics } from '../src/core/extensions/diagnostics.server';
if (process.argv.length > 2) {
  console.error('Usage: pnpm extensions');
  process.exitCode = 1;
} else {
  console.log(JSON.stringify(await extensionDiagnostics(), null, 2));
}
