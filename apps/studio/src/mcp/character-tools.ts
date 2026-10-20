import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { characterRequest } from '@/core/characters/contract';
import { changeCharacters } from '@/core/characters/service.server';
import { withToolErrors } from './tool-results';

export function registerCharacterTools(server: McpServer) {
  server.registerTool('viral_hit_character', {
    description: 'Manage reusable characters: reference images plus written invariants (what must stay the same) and forbidden changes. Actions: list, get, create (references from project images or absolute local image paths), update, add_references, remove_reference, set_canonical, archive, and use, which imports the references into a project as reference images and returns a brief to include in prompts. Keep the canonical image in every generation of that character: on Canvas, add the canonical asset as an image asset card and list it in the referenceCardIds of the draft with viral_hit_canvas_apply, and include the brief in the prompt. export writes a character file (.viralhit-character.tar with every reference image) to a new absolute path, and import adds the character from such a file; importing the same file again returns the character it created, and an id taken by a different character gets a new id. Characters never start generation by themselves.',
    inputSchema: z.object({ request: characterRequest }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, withToolErrors(async ({ request }) => changeCharacters(request)));
}
