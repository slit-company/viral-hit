# Creative performance

Viral Hit keeps a history of how each delivered post performs. A reading is a versioned observation linked to one publication. It never changes the reviewed publication, its retained media or anything at the destination. Open **Publish** in a project to see the **Performance** section below the delivery queue.

## Where readings come from

| Source | How it is read | Measures |
|---|---|---|
| YouTube | Read-only `videos?part=statistics` with the original connected channel | views, likes, comments |
| Instagram Reel | Read-only media insights with the original Page-linked account | views, reach, likes, comments, shares, saves, total_interactions |
| Instagram Story | Read-only media insights | views, reach, replies, shares, total_interactions |
| Installed connector | Its own exported `measure()` | Whatever it declares in `connector.json` |
| Manual entry | Numbers someone copied from a dashboard | Any lowercase snake_case name |

A measure the destination did not report is listed as **missing**. It is never stored as zero. A reading with some measures is **partial**; a reading with none is kept as **unavailable** with a reason (`permission-missing`, `not-found` or `unavailable`), so failed attempts stay visible in the history.

Readings run only when someone asks for one. There is no background polling. A second request for the same publication within one minute returns the previous reading instead of contacting the destination again.

Instagram insights need the `instagram_manage_insights` permission. Add it to the Facebook Login for Business configuration and reconnect the account. Publishing does not require it, so earlier connections keep publishing; their readings show as unavailable until reconnected.

## Add a metrics source without changing the app

Any installed publishing connector can report performance, whether it is general (a CDN, an archive, a newsletter platform) or specialized (one company's internal dashboard). Declare the measures in `connector.json`:

~~~json
{ "measurement": { "metrics": ["views", "downloads"] } }
~~~

This is a field fragment, not a complete manifest. Then export `measure` from the connector module:

~~~js
export async function measure({ spec, destination, environment, receipt, metrics, signal }) {
  // Read-only. receipt is what your connector returned when it delivered the post.
  const counts = await readCounts(receipt, environment, signal);
  if (!counts) return { unavailable: { issue: 'not-found' } };
  const values = Object.fromEntries(metrics.filter(name => Number.isFinite(counts[name])).map(name => [name, counts[name]]));
  return { metrics: values, missing: metrics.filter(name => !(name in values)) };
}
~~~

Discovery reads only the declaration; the module is imported when someone asks for a reading of a delivered post. Names must match `^[a-z][a-z0-9_]{0,63}$` and values must be finite and non-negative. Use the shared names `views`, `reach`, `likes`, `comments`, `shares`, `saves`, `replies`, `total_interactions`, `watch_time_seconds` and `average_view_seconds` when they fit, so posts can be compared across destinations. Other names appear after them. The bundled [local archive example](../examples/publishing-connectors/local-archive) reads `metrics.json` beside its release and needs no network.

## Agents, HTTP and CLI

All transports call the same application service.

- MCP: `viral_hit_performance_read` returns one row per delivered publication with the latest and previous readings, their change and linked asset IDs; with `publicationId` it returns every reading. `viral_hit_performance_change` takes `{ action: 'collect', publicationId }` or `{ action: 'record', publicationId, requestKey, metrics, observedAt, note? }`.
- HTTP: `GET /api/app/projects/:projectId/performance` (optionally `?publicationId=`) and `POST` with the same request body. Requests need the workspace request header.
- CLI: `pnpm --dir apps/studio performance --project ID list | history PUBLICATION_ID | collect PUBLICATION_ID | record < request.json`.

Manual entries are idempotent by `requestKey`. Repeating the same key with the same numbers returns the original entry; different numbers under that key are rejected.

## Storage and limits

Readings are appended to `data/publications/measurements.sqlite` beside the publication database. Each publication keeps an increasing sequence number. Back the two files up together.

The live YouTube and Instagram readers are covered by recorded-response tests and have not yet been run against real accounts. Readings describe what a destination reported at that time; they are not an attribution model, an audience analysis or a forecast.
