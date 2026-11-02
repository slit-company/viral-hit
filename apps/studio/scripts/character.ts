import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { characterRequest } from '../src/core/characters/contract';
import { changeCharacters } from '../src/core/characters/service.server';
import { runAsAgent } from '../src/core/agent/request-origin.server';
import { checkFaceMatch } from '../src/core/characters/face-match.server';
import { faceMatchProblem, installFaceModels } from '../src/core/characters/face-match-engine.server';

// Usage: pnpm character list | get <id> | use <id> <project-id> | export <id> <out.viralhit-character.tar> | import <file> | request <request.json>
//        pnpm character face-setup | match <project-id> <character-id> <asset-id...>
const [command, first, second, ...rest] = process.argv.slice(2);
try {
  if (command === 'face-setup') {
    // Downloads the two hash-pinned OpenCV face models once, then reports whether Python with OpenCV is ready.
    console.log(JSON.stringify({ ...await installFaceModels(), problem: await faceMatchProblem() }, null, 2));
  } else if (command === 'match' && first && second && rest.length) {
    console.log(JSON.stringify(await checkFaceMatch(first, { characterId: second, assetIds: rest }), null, 2));
  } else {
  const request = command === 'list' ? { action: 'list' } : command === 'get' && first ? { action: 'get', id: first }
    : command === 'use' && first && second ? { action: 'use', id: first, projectId: second }
    : command === 'export' && first && second ? { action: 'export', id: first, path: resolve(second) }
    : command === 'import' && first ? { action: 'import', path: resolve(first) }
    : command === 'request' && first ? JSON.parse(readFileSync(first, 'utf8')) : null;
  if (!request) throw new Error('Usage: character list | get <id> | use <id> <project-id> | export <id> <out> | import <file> | request <request.json>');
  const parsed = characterRequest.parse(request);
  console.log(JSON.stringify(await runAsAgent({ channel: 'cli', tool: 'character' }, () => changeCharacters(parsed)), null, 2));
  }
} catch (error) { console.error(error instanceof Error ? error.message : 'Character command failed'); process.exitCode = 1; }

