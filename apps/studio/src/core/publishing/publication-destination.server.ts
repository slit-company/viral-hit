import { installedConnectorId } from './installed/contract';
import { findInstalledConnector, installedDestination, validateInstalledPublication } from './installed/catalog.server';
import { openPublishingAccountManagement } from './account-management.server';
import { openInstagramAccountManagement, metaOAuthEnvironment } from './instagram-accounts.server';
import { googleOAuthEnvironment } from './youtube-accounts.server';
import { googleOAuthConfig } from './google-oauth.server';
import { metaOAuthConfig } from './meta-oauth.server';
import { validateInstagramPublication } from './instagram-connector.server';
import { validateYouTubePublication } from './youtube-connector.server';
import { PublicationRequestError } from './requests';
import type { PublicationSpec } from './contracts';

export function publishingConfigured(connector = 'youtube') {
  try {
    if (connector === 'youtube') googleOAuthConfig(googleOAuthEnvironment());
    else if (connector === 'instagram') metaOAuthConfig(metaOAuthEnvironment());
    else return findInstalledConnector(connector)?.descriptor.configured ?? false;
    return true;
  } catch { return false; }
}
export function publicationDestination(connector: string, accountId: string) {
  if (installedConnectorId.safeParse(connector).success) return installedDestination(connector, accountId);
  if (connector === 'instagram') {
    const accounts = openInstagramAccountManagement();
    try {
      const account = accounts.get(accountId);
      if (!account || account.status !== 'connected') throw new PublicationRequestError('account-unavailable', 'Connect this Instagram account before preparing or approving a publication');
      return { id: account.id, destinationId: account.instagramId, pageId: account.pageId, connectorVersion: '1' };
    } finally { accounts.close(); }
  }
  if (connector !== 'youtube') throw new PublicationRequestError('invalid-input', 'Unsupported publication connector');
  const accounts = openPublishingAccountManagement();
  try {
    const account = accounts.get(accountId);
    if (!account || account.status !== 'connected') throw new PublicationRequestError('account-unavailable', 'Connect this YouTube channel before preparing or approving a publication');
    return { id: account.id, destinationId: account.channelId, pageId: null, connectorVersion: '1' };
  } finally { accounts.close(); }
}
export function validateSupportedPublication(spec: PublicationSpec) {
  if (spec.connector === 'instagram') validateInstagramPublication(spec);
  else if (spec.connector === 'youtube') validateYouTubePublication(spec);
  else validateInstalledPublication(spec);
}
