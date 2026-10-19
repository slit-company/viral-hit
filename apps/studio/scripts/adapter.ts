import { externalCatalog, externalConfigured, readExternalCatalog } from '../src/core/harness/external-catalog';
const [command, directory] = process.argv.slice(2);
try {
  const entries = command === 'list' ? externalCatalog() : command === 'inspect' && directory ? readExternalCatalog(directory) : null;
  if (!entries) throw new Error('Usage: adapter list | adapter inspect <absolute-directory>');
  console.log(JSON.stringify({ adapters: entries.map(entry => ({ ...entry.descriptor, digest: entry.digest, configured: externalConfigured(entry) })), executableCodeLoaded: false }, null, 2));
} catch (error) { console.error(error instanceof Error ? error.message : 'Adapter inspection failed'); process.exitCode = 1; }
