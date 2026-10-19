import test from 'node:test';
import assert from 'node:assert/strict';
import { instagramMediaUrl, selectInstagramVideo } from './instagram-item.server';
import { downloadMedia } from '../harness/download-media';

const fixture = () => ({ accountId: 'account', threadId: 'thread', itemId: 'item', senderId: '123', item: {
  item_id: 'item', user_id: 123, item_type: 'media', media: { media_type: 2, video_versions: [
    { url: 'https://scontent.cdninstagram.com/clip.mp4?sig=private', width: 720, height: 1280 },
    { url: 'https://video.fbcdn.net/clip.mp4?sig=other', width: 360, height: 640 },
  ] },
} });

test('direct item selects real video_versions and scopes identity without retaining a signed URL in the key', () => {
  const input = fixture(), selected = selectInstagramVideo(input);
  assert.equal(selected.url, input.item.media.video_versions[0].url);
  assert.match(selected.sourceKey, /^[a-f0-9]{64}$/);
  input.item.media.video_versions[0].url = 'https://scontent.cdninstagram.com/refreshed.mp4?sig=new';
  assert.equal(selectInstagramVideo(input).sourceKey, selected.sourceKey);
  assert.notEqual(selectInstagramVideo({ ...input, accountId: 'other' }).sourceKey, selected.sourceKey);
  assert.notEqual(selectInstagramVideo({ ...input, threadId: 'other' }).sourceKey, selected.sourceKey);
});

test('rejects mismatched identities, preview-only shared posts, unsafe numeric IDs and disappearing media', () => {
  for (const patch of [{ itemId: 'wrong' }, { senderId: 'wrong' }, { item: { ...fixture().item, item_type: 'xma_clip' } },
    { item: { ...fixture().item, item_type: 'raven_media' } }, { item: { ...fixture().item, user_id: Number.MAX_SAFE_INTEGER + 1 } },
    { item: { ...fixture().item, media: { media_type: 1, image_versions2: { candidates: [] } } } }]) {
    assert.throws(() => selectInstagramVideo({ ...fixture(), ...patch }));
  }
});

test('Instagram URL policy rejects lookalikes, credentials, private URLs and non-CDN redirects before network access', async () => {
  for (const url of ['https://cdninstagram.com/clip', 'https://cdninstagram.com.evil.test/clip',
    'https://video.fbcdn.net@evil.test/clip', 'http://video.fbcdn.net/clip', 'https://video.fbcdn.net:444/clip',
    'https://video.fbcdn.net/clip#fragment', 'https://127.0.0.1/clip', 'https://video.fbcdn.net\\@evil.test/clip']) {
    assert.throws(() => instagramMediaUrl(url));
  }
  assert.equal(instagramMediaUrl('https://video.fbcdn.net/v?token=hidden').hostname, 'video.fbcdn.net');
  await assert.rejects(downloadMedia('https://not-a-cdn.example/secret', '/unused', AbortSignal.timeout(1000), 1024, instagramMediaUrl), /Media download failed/);
});
