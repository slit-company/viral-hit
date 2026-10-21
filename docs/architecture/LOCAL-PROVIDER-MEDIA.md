# Local media for installed generation providers

Generation providers may opt into `referenceDelivery: "project-media"`. Omission retains URL delivery and does not change the normalized manifest digest of an existing provider. This boundary is shared by general and specialized providers; it adds no worker, model service, default dependency or new generation ledger.

## Ownership and admission

`core/generation-providers/local-media.server.ts` prepares owned local references through the harness media reader. It checks active project membership, media kind, recorded size and SHA-256. Verification uses one 64 KiB buffer rather than retaining the source. Inputs are capped at 64 MiB each, 256 MiB total and 20 unique references. Remote-only assets must first be imported locally; opting in never silently uploads or fetches them.

The compiler receives canonical opaque `viral-hit-project://media/...` references containing project/asset/kind/hash/size. These are identifiers, not network URLs or filesystem paths. Normal submission still uses the existing generation intent, record and model validation. Zero upload slots are issued for local delivery. The server sets the authoritative project independently of caller parameters.

Before importing or calling a module, the runtime checks every input against that project and revalidates its original content. `createGeneration` receives `media` metadata and `readMedia(referenceUrl)`. Each read returns its own verified byte copy and metadata, never a host path. Only admitted references can be read; cumulative returned bytes are capped at 256 MiB. Verification and reads honor the existing call signal.

## Lifetime and recovery

The reader is closed in `finally` after the module resolves or throws. Outstanding reads are aborted and awaited. An asynchronous provider must consume/copy the required source before returning a task ID. `checkStatus` receives no reader; polling and managed runtime fingerprints keep their existing behavior. Failures do not create an alternate queue or silently resubmit paid work. Generation history maps retained local identifiers back to the project's existing media endpoint for playback.

Modules are trusted server code with the operator's process privileges, not sandboxed plugins. The reader provides a bounded supported interface; it is not a sandbox or whole-process RAM limit. A module may still choose an external service, so local delivery alone does not imply offline inference.

## Verification

Integration tests run an independently installed FFprobe inspector on real MP4 bytes, and a general image provider that returns the exact read bytes as a new durable asset. They also exercise foreign project IDs, changed source bytes, symlinks, malformed references, reference budgets, call closure and rejection before module import. The browser scenario uploads an actual video, runs Canvas analysis, reloads the measured report and retrieves the original from retained history.
