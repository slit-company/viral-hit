import test from 'node:test';
import assert from 'node:assert/strict';
import { createYouTubeConnector } from './youtube-connector.server';
import { createInstagramConnector } from './instagram-connector.server';
import { MeasurementUnavailable } from '../measurement/contract';
import type { PublicationSpec } from './contracts';

const signal = () => AbortSignal.timeout(10000);
const asset = { assetId: 'asset', sha256: 'a'.repeat(64), sizeBytes: 10, contentType: 'video/mp4' };
const youtubeSpec: PublicationSpec = { schemaVersion: 1, projectId: 'project', connector: 'youtube', connectorVersion: '1', accountId: 'account', destinationId: 'channel', assets: [asset],
  metadata: { title: 'Reviewed export', description: '', categoryId: '22', tags: [], privacy: 'public', madeForKids: false, containsSyntheticMedia: true, notifySubscribers: false } };
const youtubeReceipt = { videoId: 'testVideo01', channelId: 'channel', privacy: 'public', uploadStatus: 'processed' };

function youtube(reply: (url: URL) => Response) {
  const urls: URL[] = [];
  const connector = createYouTubeConnector({ accessToken: async () => 'fixture-token', fetch: async raw => { const url = new URL(String(raw)); urls.push(url); return reply(url); } });
  return { connector, urls };
}

test('YouTube reads public counters read-only and reports hidden likes as missing', async () => {
  const { connector, urls } = youtube(() => Response.json({ items: [{ id: 'testVideo01', statistics: { viewCount: '1520', commentCount: '7' } }] }));
  assert.deepEqual(await connector.measure!(youtubeSpec, youtubeReceipt, signal()), { metrics: { views: 1520, comments: 7 }, missing: ['likes'] });
  assert.equal(urls.length, 1); assert.equal(urls[0].searchParams.get('part'), 'statistics'); assert.equal(urls[0].searchParams.get('id'), 'testVideo01');
  await assert.rejects(connector.measure!(youtubeSpec, { ...youtubeReceipt, channelId: 'other' }, signal()), /another destination/);
});

test('YouTube separates a removed video and a missing permission from an outage', async () => {
  const issue = async (reply: () => Response) => {
    try { await youtube(reply).connector.measure!(youtubeSpec, youtubeReceipt, signal()); return 'resolved'; }
    catch (error) { assert.ok(error instanceof MeasurementUnavailable); return error.issue; }
  };
  assert.equal(await issue(() => Response.json({ items: [] })), 'not-found');
  assert.equal(await issue(() => new Response('{}', { status: 403 })), 'permission-missing');
  assert.equal(await issue(() => new Response('{}', { status: 500 })), 'unavailable');
});

const instagramSpec = (kind: 'reel' | 'story'): PublicationSpec => ({ schemaVersion: 1, projectId: 'project', connector: 'instagram', connectorVersion: '1', accountId: 'account', destinationId: '222', assets: [asset],
  metadata: kind === 'reel' ? { kind, caption: 'A test reel', isAiGenerated: true } : { kind, isAiGenerated: false } });
const instagramReceipt = { containerId: '333', instagramId: '222', pageId: '111', status: 'PUBLISHED', mediaId: '444' };
function instagram(insights: unknown) {
  const urls: URL[] = [];
  const connector = createInstagramConnector({ credential: async () => ({ pageId: '111', instagramId: '222', accessToken: 'token' }), fetch: async raw => {
    const url = new URL(String(raw)); urls.push(url);
    if (url.pathname === '/v26.0/111') return Response.json({ id: '111', instagram_business_account: { id: '222' } });
    if (url.pathname === '/v26.0/444/insights') return insights instanceof Response ? insights : Response.json(insights);
    throw new Error('Unexpected request');
  } });
  return { connector, urls };
}

test('Instagram reads kind-specific insights, normalizes saved and never fills gaps with zero', async () => {
  const reel = instagram({ data: [{ name: 'views', values: [{ value: 900 }] }, { name: 'reach', values: [{ value: 600 }] }, { name: 'likes', values: [{ value: 40 }] }, { name: 'saved', total_value: { value: 5 } }] });
  assert.deepEqual(await reel.connector.measure!(instagramSpec('reel'), instagramReceipt, signal()), { metrics: { views: 900, reach: 600, likes: 40, saves: 5 }, missing: ['comments', 'shares', 'total_interactions'] });
  assert.equal(reel.urls.at(-1)!.searchParams.get('metric'), 'views,reach,likes,comments,shares,saved,total_interactions');
  const story = instagram({ data: [{ name: 'replies', values: [{ value: 3 }] }] });
  assert.deepEqual(await story.connector.measure!(instagramSpec('story'), instagramReceipt, signal()), { metrics: { replies: 3 }, missing: ['views', 'reach', 'shares', 'total_interactions'] });
  assert.equal(story.urls.at(-1)!.searchParams.get('metric'), 'views,reach,replies,shares,total_interactions');
});

test('Instagram without a published media ID or with a rejected insights call is unavailable', async () => {
  const { containerId, instagramId, pageId } = instagramReceipt;
  await assert.rejects(instagram({ data: [] }).connector.measure!(instagramSpec('reel'), { containerId, instagramId, pageId, status: 'FINISHED' }, signal()), (error: unknown) => error instanceof MeasurementUnavailable && error.issue === 'not-found');
  await assert.rejects(instagram(Response.json({ error: { code: 10 } }, { status: 403 })).connector.measure!(instagramSpec('reel'), instagramReceipt, signal()), (error: unknown) => error instanceof MeasurementUnavailable && error.issue === 'unavailable');
});
