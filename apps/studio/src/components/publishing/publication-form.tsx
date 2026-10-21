import type { InstalledConnectorDescriptor } from '@/core/publishing/installed/contract';
import type { PublicationVideo } from './use-publications';
import { InstalledPublicationForm } from './installed-publication-form';
import { type ComponentProps } from 'react';
import { NativeSelect } from '@/components/ui/native-select';
import type { InstagramAccount } from '@/core/publishing/instagram-accounts-contract';
import { YouTubePublicationForm } from './youtube-publication-form';
import { InstagramPublicationForm } from './instagram-publication-form';

export function PublicationForm(props: ComponentProps<typeof YouTubePublicationForm> & { instagramAccounts: InstagramAccount[]; installedConnectors: InstalledConnectorDescriptor[]; mediaAssets: PublicationVideo[]; connector: string; onConnector: (value: string) => void }) {
  const connector = props.editing?.connector ?? props.connector;
  const installed = props.installedConnectors.find(item => item.id === connector);
  return <div className="space-y-4">
    <label className="block space-y-2 text-sm font-medium"><span>Destination</span><NativeSelect aria-label="Destination" value={connector} disabled={props.pending || Boolean(props.editing)} onChange={event => props.onConnector(event.target.value)}>{connector.startsWith('ext.') && !installed && <option value={connector}>Unavailable: {connector}</option>}<option value="youtube">YouTube</option><option value="instagram">Instagram</option>{props.installedConnectors.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</NativeSelect></label>
    {installed ? <InstalledPublicationForm key={installed.id + installed.runtimeVersion} connector={installed} assets={props.mediaAssets} pending={props.pending} editing={props.editing} change={props.change} done={props.done} /> : connector.startsWith('ext.') ? <p role="status" className="text-sm">This installed connector is unavailable. Restore its folder to edit this draft.</p> : connector === 'instagram' ? <InstagramPublicationForm {...props} accounts={props.instagramAccounts} /> : <YouTubePublicationForm {...props} />}
  </div>;
}
