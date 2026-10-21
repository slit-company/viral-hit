# Inspect installed extensions

Open **Extensions** (`/extensions`) to inspect extra model providers, execution adapters, publishing connectors and agent skills. General and specialized extensions use the same view. This report covers installed extensions; built-in Cloud API settings and social-account connections keep their existing screens.

The same read-only service is available through:

```sh
pnpm --dir apps/studio extensions
```

Agents call `viral_hit_extension_status` with `{}`. HTTP clients read `GET /api/app/extensions` (uncached). All return `checkedAt` and four groups of public metadata, capabilities, setup requirements and load problems. A failed group does not hide the others.

## What the states mean

- **Metadata loaded**: the definition was accepted and declared required settings are present. This does not prove valid credentials, successful module loading, working generation, output quality or delivery. Skill compatibility checks declared MCP tool names and minimum app version.
- **Needs setup**: a declared setting is missing or a skill is incompatible. The report returns variable names and presence, never their values. Publishing connectors report missing names only.
- **Could not load**: the definition could not be read or validated. Fix its server files using the corresponding [provider](../apps/studio/docs/PROVIDERS.md), [adapter](EXTERNAL-ADAPTERS.md), [publishing](PUBLISHING.md) or [skill](SKILLS.md) guide. Public errors omit native filesystem errors and malformed JSON contents.
- **Provider files changed**: the current provider directory metadata differs from the loaded snapshot. This is a bounded file-stat hint, not an integrity proof. Restart to load new definitions.

Refresh reads metadata; it never imports extension modules, probes accounts, generates media or publishes. There is no background polling or additional daemon. Explicit `provider check` is different: that CLI command imports the selected module to check its exports, and trusted module top-level code can run.

## Change lifecycle

Providers and adapters use process-lifetime definitions. Restart the app, MCP server and workers together after changing their files or environment. Refresh keeps the loaded executable snapshot. A new CLI process sees files as they exist at its startup. Adapter catalog validation remains atomic: one invalid manifest prevents that adapter catalog from loading; other extension groups still appear.

Skills and publishing connector metadata are rediscovered on request. Reviewed skill updates/removals in the Skills page appear in the next diagnostics read; executable extension lifecycle remains operator-managed. Server environment changes still require restarting the relevant process. Changed publishing configuration does not transfer old approval to a new operation: the existing pinned fingerprint and review rules remain in force.

Model providers can declare required environment names in `provider.json`:

```json
{ "environment": ["MY_MODEL_API_KEY", "MY_MODEL_BASE_URL"] }
```

This is a field fragment, not a complete provider manifest. Omission means no declared required variables. Blank/whitespace values count as missing. Missing required values make installed models unavailable in discovery and block generation preflight before an upload intent, remote reference upload or generation record is created. Presence does not validate a value. The module reads its own settings from `process.env`; none are copied into browser metadata.

Diagnostics do not install, update or remove runtime code. Automated dependency installation, version management, community discovery and live provider acceptance remain separate work.
