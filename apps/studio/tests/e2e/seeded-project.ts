import { readFile } from 'node:fs/promises';

/** Written by this run's seed script before the web server becomes ready. */
export async function seededProject(name: string): Promise<string> {
  const projects: Record<string, unknown> = JSON.parse(await readFile('../../research/evidence/browser-fixtures/projects.json', 'utf8'));
  const id = projects[name];
  if (typeof id !== 'string' || !id) throw Error('E2E project was not seeded: ' + name);
  return id;
}
