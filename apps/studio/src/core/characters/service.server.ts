import type { CharacterRequest } from './contract';
import { importCharacterFile, writeCharacterFile } from './character-file.server';
import { changeCharacterLibrary, type UploadedReference } from './library.server';
import { checkCharacterIdentity, identityServices, trainCharacterIdentity } from './identity.server';

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
  if (request.action === 'identity_services') return { services: identityServices() };
  if (request.action === 'train_identity') return trainCharacterIdentity(request);
  if (request.action === 'check_identity') return checkCharacterIdentity(request);
  return changeCharacterLibrary(request, uploads);
}
