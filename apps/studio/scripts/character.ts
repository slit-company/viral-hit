import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { characterRequest } from '../src/core/characters/contract';
import { changeCharacters } from '../src/core/characters/service.server';

// Usage: pnpm character list | get <id> | use <id> <project-id> | export <id> <out.viralhit-character.tar> | import <file> | request <request.json>
const [command, first, second] = process.argv.slice(2);
try {
  const request = command === 'list' ? { action: 'list' } : command === 'get' && first ? { action: 'get', id: first }
    : command === 'use' && first && second ? { action: 'use', id: first, projectId: second }
    : command === 'export' && first && second ? { action: 'export', id: first, path: resolve(second) }
    : command === 'import' && first ? { action: 'import', path: resolve(first) }
    : command === 'request' && first ? JSON.parse(readFileSync(first, 'utf8')) : null;
  if (!request) throw new Error('Usage: character list | get <id> | use <id> <project-id> | export <id> <out> | import <file> | request <request.json>');
  console.log(JSON.stringify(await changeCharacters(characterRequest.parse(request)), null, 2));
} catch (error) { console.error(error instanceof Error ? error.message : 'Character command failed'); process.exitCode = 1; }

