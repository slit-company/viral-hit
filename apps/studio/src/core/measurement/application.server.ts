import { getActiveProject } from '../projects/projects';
import { openPublications } from '../publishing/publication-files.server';
import { openPublicationRuntime } from '../publishing/runtime.server';
import { installedConnectorId } from '../publishing/installed/contract';
import { readInstalledConnectors, type InstalledConnector } from '../publishing/installed/catalog.server';
import { instagramMetadataSchema } from '../publishing/instagram-contract';
import { youtubeMetadataSchema } from '../publishing/youtube-contract';
import { instagramMetricNames, YOUTUBE_METRICS } from '../publishing/platform-metrics';
import type { PublicationRecord } from '../publishing/contracts';
import { measurementQuery, measurementRequest, measurementResultSchema, MeasurementRequestError, MeasurementUnavailable, metricChange, orderMetrics, type MeasurementIssue, type MeasurementSnapshot } from './contract';
import { openMeasurements } from './store.server';

/** One remote reading per publication per minute; a quicker repeat returns the last reading. */
export const COLLECTION_INTERVAL_MS = 60_000;
const DELIVERED = ['published', 'ready'];

async function requireProject(projectId: string, signal: AbortSignal) {
  signal.throwIfAborted();
  const project = await getActiveProject({ projectId });
  if (!project) throw new MeasurementRequestError('not-found', 'Project not found');
  return project;
}
/** Declared measures, or null when the connector cannot report any. Never imports extension code. */
export function declaredMetrics(record: PublicationRecord, installed: InstalledConnector[]) {
  const { spec } = record;
  if (spec.connector === 'youtube') return [...YOUTUBE_METRICS];
  if (spec.connector === 'instagram') { const metadata = instagramMetadataSchema.safeParse(spec.metadata); return metadata.success ? instagramMetricNames(metadata.data.kind) : null; }
  if (!installedConnectorId.safeParse(spec.connector).success) return null;
  return installed.find(entry => entry.manifest.id === spec.connector)?.manifest.measurement?.metrics.slice() ?? null;
}
function title(record: PublicationRecord, installed: InstalledConnector[]) {
  const youtube = youtubeMetadataSchema.safeParse(record.spec.metadata);
  if (youtube.success) return youtube.data.title;
  const instagram = instagramMetadataSchema.safeParse(record.spec.metadata);
  if (instagram.success) return (instagram.data.kind === 'reel' && instagram.data.caption?.split('\n')[0]?.trim()) || (instagram.data.kind === 'reel' ? 'Instagram Reel' : 'Instagram Story');
  const metadata = record.spec.metadata;
  if (metadata && typeof metadata === 'object' && !Array.isArray(metadata) && typeof metadata.title === 'string') return metadata.title;
  return installed.find(entry => entry.manifest.id === record.spec.connector)?.manifest.label ?? record.spec.connector;
}
function summary(record: PublicationRecord, installed: InstalledConnector[], recent: MeasurementSnapshot[], lastAttempt: MeasurementSnapshot | null) {
  const metrics = declaredMetrics(record, installed), delivered = DELIVERED.includes(record.state) && record.receipt !== null;
  const [latest = null, previous = null] = recent;
  return {
    publicationId: record.id, connector: record.spec.connector, title: title(record, installed).slice(0, 200), state: record.state,
    destination: ({ youtube: 'YouTube', instagram: 'Instagram' } as Record<string, string>)[record.spec.connector] ?? installed.find(entry => entry.manifest.id === record.spec.connector)?.manifest.label ?? record.spec.connector,
    assetIds: record.spec.assets.map(asset => asset.assetId), publishedAt: delivered ? record.updatedAt : null,
    declaredMetrics: metrics ?? [], canCollect: Boolean(delivered && metrics), canRecord: delivered,
    latest, previous, change: metricChange(latest, previous), lastAttempt,
  };
}
function loadPublication(projectId: string, publicationId: string) {
  const store = openPublications();
  try {
    const record = store.get(projectId, publicationId);
    if (!record) throw new MeasurementRequestError('not-found', 'Publication not found in this project');
    return record;
  } finally { store.close(); }
}

/** Latest and previous readings for every delivered publication in a project. */
export async function readPerformance(projectId: string, signal = AbortSignal.timeout(30000)) {
  const project = await requireProject(projectId, signal), installed = readInstalledConnectors().entries, measurements = openMeasurements();
  try {
    const publications = openPublications();
    let records: PublicationRecord[];
    try { records = publications.list(projectId); } finally { publications.close(); }
    const recent = measurements.recent(projectId), attempts = measurements.attempts(projectId);
    const items = records.filter(record => (DELIVERED.includes(record.state) && record.receipt !== null) || recent.has(record.id))
      .map(record => summary(record, installed, recent.get(record.id) ?? [], attempts.get(record.id) ?? null));
    return { project: { id: project.id, name: project.name }, metrics: orderMetrics(items.flatMap(item => [...item.declaredMetrics, ...Object.keys(item.latest?.metrics ?? {})])), items };
  } finally { measurements.close(); }
}
/** Every reading for one publication, newest first, including unavailable attempts. */
export async function readPublicationPerformance(projectId: string, raw: unknown, signal = AbortSignal.timeout(30000)) {
  const query = measurementQuery.safeParse(raw);
  if (!query.success || !query.data.publicationId) throw new MeasurementRequestError('invalid-input', 'Choose a publication');
  const project = await requireProject(projectId, signal), installed = readInstalledConnectors().entries, measurements = openMeasurements();
  try {
    const record = loadPublication(projectId, query.data.publicationId), history = measurements.history(projectId, record.id);
    const usable = history.filter(item => item.state !== 'unavailable');
    return { project: { id: project.id, name: project.name }, publication: summary(record, installed, usable.slice(0, 2), history[0] ?? null), history };
  } finally { measurements.close(); }
}

async function collect(projectId: string, record: PublicationRecord, actor: string, signal: AbortSignal) {
  const metrics = declaredMetrics(record, readInstalledConnectors().entries);
  if (!DELIVERED.includes(record.state) || record.receipt === null) throw new MeasurementRequestError('not-measurable', 'Only delivered publications have performance readings');
  if (!metrics) throw new MeasurementRequestError('not-measurable', 'This destination does not report performance; record numbers manually instead');
  const measurements = openMeasurements();
  try {
    const last = measurements.lastCollection(projectId, record.id);
    if (last && Date.now() - last.collectedAt < COLLECTION_INTERVAL_MS) return { snapshot: last, reused: true };
  } finally { measurements.close(); }
  const runtime = openPublicationRuntime();
  let reading: { metrics: Record<string, number>; missing: string[]; observedAt?: number } | null = null, issue: MeasurementIssue | null = null;
  try {
    let connector;
    try { connector = await runtime.connector(record.spec, signal); }
    catch { throw new MeasurementRequestError('runtime-unavailable', 'The original account or connector is unavailable; check Connections'); }
    if (!connector.measure) throw new MeasurementRequestError('not-measurable', 'This connector does not report performance');
    // Remote reads happen outside any database transaction.
    try { reading = measurementResultSchema.parse(await connector.measure(record.spec, record.receipt, AbortSignal.any([signal, AbortSignal.timeout(45000)]))); }
    catch (error) { if (signal.aborted) throw error; issue = error instanceof MeasurementUnavailable ? error.issue : 'unavailable'; }
  } finally { runtime.close(); }
  const values = reading?.metrics ?? {}, missing = orderMetrics([...(reading?.missing ?? []), ...metrics.filter(name => !(name in values))]).filter(name => !(name in values));
  const state = !reading || !Object.keys(values).length ? 'unavailable' : missing.length ? 'partial' : 'complete';
  const store = openMeasurements();
  try {
    return { reused: false, snapshot: store.append({ projectId, publicationId: record.id, source: 'connector', connector: record.spec.connector, connectorVersion: record.spec.connectorVersion,
      actor, state, issue: state === 'unavailable' ? issue ?? 'not-found' : null, metrics: values, missing, note: null, observedAt: reading?.observedAt ?? Date.now() }) };
  } finally { store.close(); }
}

/** HTTP, MCP and CLI share collection and manual entry. Neither changes the publication or its media. */
export async function changePerformance(projectId: string, raw: unknown, actor: 'ui' | 'mcp' | 'cli', signal = AbortSignal.timeout(60000)) {
  const parsed = measurementRequest.safeParse(raw);
  if (!parsed.success) throw new MeasurementRequestError('invalid-input', parsed.error.issues[0]?.message ?? 'Invalid performance request');
  const input = parsed.data;
  await requireProject(projectId, signal);
  const record = loadPublication(projectId, input.publicationId);
  if (input.action === 'collect') return collect(projectId, record, actor, signal);
  if (!DELIVERED.includes(record.state) || record.receipt === null) throw new MeasurementRequestError('not-measurable', 'Record numbers after the publication is delivered');
  const observedAt = Date.parse(input.observedAt);
  if (observedAt > Date.now() + 300_000 || observedAt < record.createdAt - 86_400_000) throw new MeasurementRequestError('invalid-input', 'Choose when these numbers were observed, after delivery and not in the future');
  const store = openMeasurements();
  try {
    return { reused: false, snapshot: store.append({ projectId, publicationId: record.id, source: 'manual', connector: record.spec.connector, connectorVersion: record.spec.connectorVersion,
      actor, state: 'complete', issue: null, metrics: input.metrics, missing: [], note: input.note || null, observedAt, requestKey: input.requestKey }) };
  } catch (error) {
    throw new MeasurementRequestError('conflict', error instanceof Error && error.message.includes('Request key') ? 'This request key was already used for different numbers' : 'Performance could not be recorded');
  } finally { store.close(); }
}
