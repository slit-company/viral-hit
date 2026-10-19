import { resolve } from 'node:path';
import { getViralHitDataRoot } from '../../config/data-root';
import { PublicationAccountStore } from './account-store.server';
import { openCredentialVault } from './credential-vault.server';

/** Local account management stays available when provider configuration is missing or changed. */
export function openPublishingAccountManagement(options: { root?: string; key?: string } = {}) {
  const vault = openCredentialVault(options.root ?? resolve(getViralHitDataRoot(), 'publishing-accounts'), options.key ?? process.env.VIRAL_HIT_PUBLISHING_KEY);
  let store: PublicationAccountStore;
  try { store = new PublicationAccountStore(vault); } catch (error) { vault.close(); throw error; }
  return {
    list: () => store.list(),
    get: (id: string) => store.get(id),
    disconnect: (id: string, revision: number) => store.disconnect(id, revision),
    close() { store.close(); vault.close(); },
  };
}
