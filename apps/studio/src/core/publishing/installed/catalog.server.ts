import { managedRuntimeEntries } from '@/core/runtime-packages/snapshot.server';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import Ajv, { type ValidateFunction } from 'ajv';
import { canonicalJson } from '@/lib/canonical-json';
import { publicationSpecSchema, type PublicationSpec } from '../contracts';
import { PublicationRequestError } from '../requests';
import { connectorManifestSchema, installedConnectorId, publicConnectorDeliverySchema, type ConnectorManifest, type ExternalPublicationReview, type InstalledConnectorCatalog, type InstalledConnectorDescriptor } from './contract';

type Files = { manifest: ConnectorManifest; source: string; definitionHash: string; validate: ValidateFunction };
export type InstalledConnector = Files & { runtimeVersion: string; environment: Record<string, string>; descriptor: InstalledConnectorDescriptor };
const cache = new Map<string, { stamp: string; files: Files }>();
const stamp = (path: string, max: number) => {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.size < 1 || stat.size > max) throw new Error('Connector files must be bounded regular files');
  return [stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs].join(':');
};

export function readConnectorFolder(path: string): InstalledConnector {
  const manifestPath = join(path, 'connector.json');
  const manifestStamp = stamp(manifestPath, 64_000), previous = cache.get(path);
  const manifest = previous?.stamp.startsWith(manifestStamp + '|') ? previous.files.manifest
    : connectorManifestSchema.parse(JSON.parse(readFileSync(manifestPath, 'utf8')));
  if (manifest.id.slice(4) !== basename(path)) throw new Error('Folder must match the connector ID after ext.');
  const entryPath = join(path, manifest.entry), signature = manifestStamp + '|' + stamp(entryPath, 2_000_000);
  let files = previous?.stamp === signature ? previous.files : undefined;
  if (!files) {
    const validate = new Ajv({ strict: true, allErrors: false, ownProperties: true }).compile(manifest.metadataSchema);
    const source = readFileSync(entryPath, 'utf8');
    files = { manifest, source, definitionHash: createHash('sha256').update(canonicalJson({ manifest, source })).digest('hex'), validate };
    if (Buffer.byteLength(files.source) > 2_000_000) throw new Error('Connector module exceeds 2 MB');
    if (cache.size >= 32 && !cache.has(path)) cache.delete(cache.keys().next().value!);
    cache.set(path, { stamp: signature, files });
  }
  return configuredConnector(files);
}

export function validateConnectorSource(raw: unknown, source: string): Files {
  const manifest = connectorManifestSchema.parse(raw);
  if (Buffer.byteLength(source) < 1 || Buffer.byteLength(source) > 2_000_000) throw new Error('Connector module must contain 1 byte to 2 MB');
  const validate = new Ajv({ strict: true, allErrors: false, ownProperties: true }).compile(manifest.metadataSchema);
  return { manifest, source, validate, definitionHash: createHash('sha256').update(canonicalJson({ manifest, source })).digest('hex') };
}
function configuredConnector(files: Files): InstalledConnector {
  const { manifest } = files;
  const environment = Object.fromEntries(manifest.environment.map(name => [name, process.env[name] ?? '']));
  // Pin code, configuration, destinations and environment values. Public discovery never returns those values.
  const hash = createHash('sha256').update(canonicalJson({ definitionHash: files.definitionHash, environment })).digest('hex');
  const runtimeVersion = manifest.version + ':' + hash;
  const missingEnvironment = manifest.environment.filter(name => !environment[name]);
  const { id, version, label, description, scope, author, license, mediaTypes, maxAssets, metadataSchema } = manifest;
  const descriptor: InstalledConnectorDescriptor = { id, version, label, description, scope, author, license, mediaTypes, maxAssets, metadataSchema,
    runtimeVersion, configured: !missingEnvironment.length, missingEnvironment,
    destinations: manifest.destinations.map(({ configuration: _, ...destination }) => destination) };
  return { ...files, runtimeVersion, environment, descriptor };
}

export function readInstalledConnectors(directory = process.env.VIRAL_HIT_PUBLISHING_CONNECTORS_DIR?.trim(), includeManaged = true) {
  const entries: InstalledConnector[] = [], problems: InstalledConnectorCatalog['problems'] = [];
  const managed = includeManaged ? managedRuntimeEntries('publishing') : [];
  if (!directory && !managed.length) return { entries, problems };
  let folders: string[];
  try { folders = directory ? readdirSync(directory, { withFileTypes: true }).filter(item => item.isDirectory() && !item.name.startsWith('.')).map(item => item.name).sort() : []; }
  catch { return { entries, problems: [{ location: basename(directory ?? 'managed'), message: 'Publishing connector folder is unavailable' }] }; }
  if (folders.length + managed.length > 32) return { entries, problems: [{ location: basename(directory ?? 'managed'), message: 'At most 32 publishing connectors may be installed' }] };
  let bytes = 0;
  for (const folder of folders) {
    try {
      const entry = readConnectorFolder(resolve(directory!, folder)); bytes += Buffer.byteLength(entry.source);
      if (bytes > 8_000_000) { cache.delete(resolve(directory!, folder)); problems.push({ location: folder, message: 'Installed publishing modules exceed 8 MB' }); break; }
      entries.push(entry);
    } catch { problems.push({ location: folder, message: 'Connector files or metadata schema are invalid; run the connector check command for details' }); }
  }
  for (const source of managed) {
    try {
      const entry = configuredConnector(validateConnectorSource(source.manifest, source.source));
      bytes += Buffer.byteLength(source.source);
      if (bytes > 8_000_000) throw new Error('Combined publishing modules exceed 8 MB');
      if (entries.some(item => item.manifest.id === entry.manifest.id)) throw new Error('Managed connector conflicts with operator ID');
      entries.push(entry);
    } catch { problems.push({ location: String(source.manifest.id), message: 'Managed connector conflicts or exceeds capacity; review runtime packages' }); }
  }
  return { entries, problems };
}
export function installedConnectorCatalog(): InstalledConnectorCatalog {
  const { entries, problems } = readInstalledConnectors(); return { connectors: entries.map(entry => entry.descriptor), problems };
}
export function findInstalledConnector(id: string) { return readInstalledConnectors().entries.find(entry => entry.manifest.id === id); }
export function requireInstalledConnector(id: string) {
  const entry = findInstalledConnector(id);
  if (!entry) throw new PublicationRequestError('runtime-unavailable', 'The installed publishing connector is unavailable');
  return entry;
}
export function installedDestination(id: string, accountId: string) {
  const entry = requireInstalledConnector(id), destination = entry.manifest.destinations.find(item => item.id === accountId);
  if (!destination) throw new PublicationRequestError('account-unavailable', 'The configured publishing destination is unavailable');
  return { id: destination.id, destinationId: destination.destinationId, pageId: null, connectorVersion: entry.runtimeVersion };
}
export function validateInstalledPublication(spec: PublicationSpec, entry = requireInstalledConnector(spec.connector)) {
  if (entry.manifest.id !== spec.connector) throw new PublicationRequestError('runtime-unavailable', 'Wrong publishing connector');
  if (spec.connectorVersion !== entry.runtimeVersion) throw new PublicationRequestError('runtime-unavailable', 'The publishing connector or its configuration changed. Review a new draft before delivery.');
  if (!entry.validate(spec.metadata)) throw new PublicationRequestError('invalid-input', 'Metadata does not match the installed connector schema: ' + (entry.validate.errors?.[0]?.instancePath ?? '') + ' ' + (entry.validate.errors?.[0]?.message ?? 'invalid'));
  const destination = entry.manifest.destinations.find(item => item.id === spec.accountId);
  if (!destination || destination.destinationId !== spec.destinationId) throw new PublicationRequestError('account-unavailable', 'The original publishing destination changed');
  if (!spec.assets.length || spec.assets.length > entry.manifest.maxAssets || spec.assets.some(asset => !entry.manifest.mediaTypes.includes(asset.contentType as never))) throw new PublicationRequestError('media-unavailable', 'Choose media types and a file count supported by this connector');
  return entry;
}
/** Retained review remains readable if a connector is removed or changed; approval/execution still require an exact match. */
export function installedPublicationReview(spec: PublicationSpec, entries = readInstalledConnectors().entries, receipt?: unknown): ExternalPublicationReview | undefined {
  if (!installedConnectorId.safeParse(spec.connector).success || !publicationSpecSchema.safeParse(spec).success) return;
  const entry = entries.find(item => item.manifest.id === spec.connector);
  let available = false;
  try { if (entry) available = validateInstalledPublication(spec, entry).descriptor.configured; } catch { /* Keep the reviewed snapshot visible. */ }
  const title = spec.metadata && typeof spec.metadata === 'object' && !Array.isArray(spec.metadata) && typeof spec.metadata.title === 'string' ? spec.metadata.title : entry?.manifest.label ?? spec.connector;
  const delivery = publicConnectorDeliverySchema.safeParse(receipt && typeof receipt === 'object' && 'publicDelivery' in receipt ? receipt.publicDelivery : null);
  return { delivery: delivery.success ? delivery.data : null, label: entry?.manifest.label ?? spec.connector, title: title.slice(0, 200), available, assets: spec.assets, metadata: spec.metadata };
}
