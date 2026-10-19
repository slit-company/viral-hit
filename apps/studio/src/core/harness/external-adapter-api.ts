import type { Adapter, Json } from './durable';

/** Version 1 of the trusted, server-installed adapter API. Only the worker imports its module. */
export type BinaryOutputContext = {
  readBinary(): Promise<Json | null>;
  publishBinary(bytes: Uint8Array, details: { model: string; providerJobId: string; contentType: string; creditsUsed?: string | null }): Promise<Json>;
};
export type ExternalAdapter = Omit<Adapter, 'submit' | 'poll'> & {
  submit(input: Json, context: Parameters<Adapter['submit']>[1] & BinaryOutputContext): ReturnType<Adapter['submit']>;
  poll(id: string, input: Json, signal: AbortSignal, context: NonNullable<Parameters<Adapter['poll']>[3]> & BinaryOutputContext): ReturnType<Adapter['poll']>;
};
