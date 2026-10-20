import type { CharacterRequest } from './contract';
import { importCharacterFile, writeCharacterFile } from './character-file.server';
import { changeCharacterLibrary, type UploadedReference } from './library.server';

/**
 * The one entry point shared by HTTP, MCP and CLI. Transports validate trust first; uploaded image
 * bytes and an uploaded character file path are only passed in by the HTTP transport.
 */
export async function changeCharacters(request: CharacterRequest, uploads: UploadedReference[] = [], uploadedFile?: string) {
  if (request.action === 'export') return writeCharacterFile(request.id, request.path);
  if (request.action === 'import') {
    const path = uploadedFile ?? request.path;
    if (!path) throw new Error('Choose a character file to import');
    return importCharacterFile(path);
  }
  return changeCharacterLibrary(request, uploads);
}
