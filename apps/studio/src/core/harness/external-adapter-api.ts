import type { Adapter, Json } from './durable';
import type { ProjectMediaPin } from './project-media-input-schema';

/** Version 1 of the trusted, server-installed adapter API. Only the worker imports its module. */
export type BinaryOutputContext = {
  readAsset(name: string): Promise<ProjectMediaPin & { bytes: Uint8Array; mimeType: string | null; filename: string | null }>;
  readBinary(): Promise<Json | null>;
  publishBinary(bytes: Uint8Array, details: { model: string; providerJobId: string; contentType: string; creditsUsed?: string | null }): Promise<Json>;
};
export type ExternalAdapter = Omit<Adapter, 'submit' | 'poll'> & {
  submit(input: Json, context: Parameters<Adapter['submit']>[1] & BinaryOutputContext): ReturnType<Adapter['submit']>;
  poll(id: string, input: Json, signal: AbortSignal, context: NonNullable<Parameters<Adapter['poll']>[3]> & BinaryOutputContext): ReturnType<Adapter['poll']>;
};
