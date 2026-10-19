import { type ComponentProps } from 'react';
import { NativeSelect } from '@/components/ui/native-select';
import type { InstagramAccount } from '@/core/publishing/instagram-accounts-contract';
import { YouTubePublicationForm } from './youtube-publication-form';
import { InstagramPublicationForm } from './instagram-publication-form';

export function PublicationForm(props: ComponentProps<typeof YouTubePublicationForm> & { instagramAccounts: InstagramAccount[]; connector: string; onConnector: (value: string) => void }) {
  const connector = props.editing?.connector ?? props.connector;
  return <div className="space-y-4">
    <label className="block space-y-2 text-sm font-medium"><span>Destination</span><NativeSelect aria-label="Destination" value={connector} disabled={props.pending || Boolean(props.editing)} onChange={event => props.onConnector(event.target.value)}><option value="youtube">YouTube</option><option value="instagram">Instagram</option></NativeSelect></label>
    {connector === 'instagram' ? <InstagramPublicationForm {...props} accounts={props.instagramAccounts} /> : <YouTubePublicationForm {...props} />}
  </div>;
}
