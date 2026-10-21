# Managed runtime packages

A runtime package distributes complete, self-contained modules for image/video providers, workflow adapters and publishing connectors. It can combine any of those kinds, and its scope can be general or specialized for one format/team/job. Existing recipes, skills and creative packs remain data-only; installing them cannot install executable code.

Use **Extensions → Manage runtime packages**, `pnpm runtime-package` from `apps/studio`, the `viral_hit_runtime_package` MCP tool, or the trusted local `/api/app/runtime-packages` HTTP endpoint. The browser library distinguishes the installed set from the version loaded by this studio process. Independent catalog downloads for executable packages are not yet implemented.

## Use the browser library

1. Choose **Import runtime file** and a portable JSON package. This opens inspection only. Review the package ID, version, scope, requirements and every added/replaced/removed entry. Open each entry to read its complete manifest and source; download either definition if you want to review it elsewhere.
2. For an update, both the installed and incoming definitions are retained in the review. Confirm trust in the exact package source, then choose **Install package** or **Update package**. Blocking conflicts disable the action. If another operator changes the catalog, the old review is rejected; **Review again** reads current state and clears the prior confirmation.
3. The library shows the saved version and what this studio process loaded. Restart the studio, MCP and workers together to activate changes; refreshing only reads metadata. An installed package may still need its declared settings or external engine.
4. **Versions & downloads** exports any retained release. **Review restoration** inspects that exact historical package against current state; trust confirmation and normal conflict checks apply again.
5. **Remove…** opens the complete installed definition and removal consequences. Confirm the package ID before removal. The card remains as a history entry, while loaded code stays until restart. General and specialized filters apply to both installed and removed packages.

Sources are shown as plain text, never evaluated or rendered as HTML. Long module text is mounted only when that entry is expanded. The browser sends the same digest-bound requests as CLI/MCP; it does not implement its own package storage, execution or activation.

## Author a package

Keep the existing contracts: [adapters](EXTERNAL-ADAPTERS.md), [generation providers](EXTENDING.md) and [publishing connectors](PUBLISHING.md). Bundle each module's dependencies into its source file; `node:` built-ins remain available. External engines such as music2, vid2, ima2, .NET or ComfyUI stay separately installed and start only when needed. Package installation does not run npm/Bun/install scripts, download a model or repair an environment.

Create a build-plan JSON using absolute source folders:

```json
{
  "schemaVersion": 1,
  "kind": "viral-hit-runtime-package",
  "id": "my-creative-engines",
  "version": "1.0.0",
  "title": "My creative engines",
  "description": "Reusable local tools for any project",
  "scope": "general",
  "author": "Your name",
  "license": "MIT",
  "requirements": "Declare any external engines and configuration here",
  "entries": [
    { "kind": "adapter", "path": "/absolute/adapter-folder" },
    { "kind": "provider", "path": "/absolute/provider-id" },
    { "kind": "publishing", "path": "/absolute/connector-name" }
  ]
}
```

Choose only the entry kinds you need. An adapter folder can contain several descriptor/module pairs. Provider and connector folders each identify one implementation. Run:

```sh
pnpm runtime-package build /absolute/plan.json /absolute/new-runtime.json
pnpm runtime-package inspect /absolute/new-runtime.json
```

The new JSON contains each complete normalized manifest and source string. Building validates and copies contents without importing the module. Review the actual source and declarations before sharing; source files and connector destination configuration are included. Environment values are never collected. The [JSON Schema](schemas/runtime-package.schema.json) describes portable input.

## Review and apply

MCP uses `{ "request": { "action": "inspect", "package": <file contents> } }`. HTTP posts the inner request. Inspection includes complete current/incoming manifests and code, changes, blocking collisions, incoming `digest`, `stateDigest` and restart information. Inspecting does not register models, import modules, validate credentials or prove code behavior/safety.

For an authorized install/update, apply the exact reviewed package:

```json
{
  "action": "apply",
  "package": { "...": "the complete reviewed package" },
  "expectedDigest": "<inspection.digest>",
  "expectedStateDigest": "<inspection.stateDigest>",
  "trustCode": true
}
```

`trustCode` is an explicit trust decision: modules run with the host's filesystem, environment and network privileges. They are not sandboxed or signed. Apply replaces the whole package release, including removing entries absent from the incoming release. It cannot overwrite operator folder files or identities owned by other packages. Both tokens and all managed writes are compared in one SQLite transaction; stale reviews need fresh inspection. Operator files are hashed again before commit, but independently edited filesystem directories do not participate in that SQLite transaction.

Use `pnpm runtime-package change < /absolute/request.json`. `list` distinguishes desired installed packages from this process's loaded snapshot. Restart the studio, MCP and workers together after changes. No hot reload is attempted. A package reported installed is stored desired state; required environment settings and separate engines may still be absent, and runtime execution is not verified by installation.

## Remove, restore and protect work

Call `review-remove` with `id`, then authorized `remove` with `id` and the returned `stateDigest` as `expectedStateDigest`. This removes the desired active package. Already running processes retain their loaded source until restarted. Jobs, project media, publishing receipts and retained releases are untouched.

`history` lists retained digests, including removed packages. `export` returns the normalized package at an optional historical `digest`; CLI syntax is `export <id> <new-file> [digest]`. To restore, inspect that historical package against the current catalog, apply with fresh tokens and restart the processes. This is explicit restoration, not an automatic downgrade or task migration.

Workflow jobs retain existing adapter/configuration fingerprints. Approved publications retain their connector runtime version. Managed provider tasks now retain code/model/declared-configuration fingerprints in their persisted task identity, with the original remote task ID alongside it. A mismatched runtime refuses status checks before importing source. Restoring the exact release/configuration restores eligibility; an untracked operator task requires its original operator runtime. Installation does not establish provider idempotency, quality, cancellation support or recovery from a lost initial submission response.

## Limits and transport

Up to 16 entries/package, 12 MB compact serialized input, 8 MB source/package, 32 active entries and 8 MB source per kind across managed packages. Operator and managed entries share the existing loader caps. Manifests are at most 64 KB; adapter/connector modules at most 2 MB; provider modules at most 5 MiB. Storage retains at most 64 package identities and 128 MiB of release documents; historical purge is not implemented. Downloads use compact JSON so a package at the byte limit can be imported again. The CLI writes new files only. HTTP requires the workspace trust header, bounded JSON and rejects host paths; it does not accept an executable URL. No new runtime dependency or background poller is added.
