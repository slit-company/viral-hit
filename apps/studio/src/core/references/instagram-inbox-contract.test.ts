import test from 'node:test';
import assert from 'node:assert/strict';
import { graphTime, inboxMediaUrl, inboxVideos } from './instagram-inbox-contract';

const video = 'https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=1&signature=fixture';
const reel = 'https://scontent-icn2-1.cdninstagram.com/o1/v/t16/clip.mp4?efg=fixture';
const conversation = { id: 'aWdfZAG06conversation', messages: { data: [
  { id: 'm1', created_time: '2026-11-03T01:00:00+0000', from: { id: '9001', username: 'fan_one' }, attachments: { data: [{ video_data: { url: video } }, { image_data: { url: 'https://lookaside.fbsbx.com/image' } }] } },
  { id: 'm2', created_time: '2026-11-03T02:00:00+0000', from: { id: '9002', username: 'fan_two' }, shares: { data: [{ type: 'ig_reel', url: reel }, { type: 'ig_post', url: reel }] } },
  { id: 'm3', created_time: '2026-11-03T03:00:00+0000', from: { id: '222', username: 'studio' }, attachments: { data: [{ video_data: { url: video } }] } },
  { id: 'm4', from: { id: '9003' }, attachments: { data: [{ video_data: { url: 'https://example.com/clip.mp4' } }] } },
] } };

test('only videos other people sent become candidates, with stable per-item indexes', () => {
  assert.deepEqual(inboxVideos(conversation, '222'), [
    { conversationId: 'aWdfZAG06conversation', messageId: 'm1', index: 0, kind: 'video', url: video, senderId: '9001', senderUsername: 'fan_one', sentAt: Date.parse('2026-11-03T01:00:00Z') },
    { conversationId: 'aWdfZAG06conversation', messageId: 'm2', index: 100, kind: 'reel', url: reel, senderId: '9002', senderUsername: 'fan_two', sentAt: Date.parse('2026-11-03T02:00:00Z') },
  ]);
  assert.deepEqual(inboxVideos({ id: 'empty' }, '222'), []);
  assert.throws(() => inboxVideos({ id: '../bad path' }, '222'));
});

test('media links are limited to Meta hosts over HTTPS and Graph times are parsed', () => {
  for (const url of [video, reel, 'https://video.xx.fbcdn.net/v/clip.mp4']) assert.equal(inboxMediaUrl(url).protocol, 'https:');
  for (const url of ['http://lookaside.fbsbx.com/x', 'https://evil.fbsbx.com/x', 'https://cdninstagram.com.evil.com/x', 'https://lookaside.fbsbx.com:8443/x', 'https://user:pass@video.fbcdn.net/x', 'not a url']) assert.throws(() => inboxMediaUrl(url));
  assert.equal(graphTime('2026-11-03T01:02:03+0000'), Date.parse('2026-11-03T01:02:03Z'));
  assert.equal(graphTime('soon'), null); assert.equal(graphTime(undefined), null);
});
