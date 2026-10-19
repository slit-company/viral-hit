# 001: Separate public model metadata from server execution

Status: accepted for this implementation.

The model picker needs labels, capabilities and model bindings. Previously it reached the executable provider registry, which imported adapters, configuration and database code. Broad registry/effect barrels also formed runtime dependency cycles. Tree shaking may remove some code, but it is not a maintainable ownership boundary.

`core/generation-providers/catalog.ts` now owns browser-safe metadata and model lookup. `registry.ts` owns executable adapters and server configuration. Shared provider metadata lives in a pure module such as `cloud-api-catalog.ts`; the server definition composes that same object. Server registration rejects a definition that disagrees with its public metadata.

Source-level provider extensions register public metadata in `config/generation-catalog.ts` and execution in `config/generation-providers.ts`. Select the active source-level provider in the public catalog configuration. Never put credentials, SDK clients or database reads there. External harness adapters retain their separate descriptor/module installation contract and do not need either source hook.

The architecture checker follows transitive component runtime imports, including re-exports and literal dynamic imports. It rejects known server dependencies and explicit `*.server.*` modules. Type-only edges are excluded. Runtime cycles are currently zero; no cycle or browser/server exemption is recorded. The existing size baseline is bounded debt, not a structural endorsement. Runtime loading and package internals still require review.
