# Optional app and website inspection

Connect [REA](https://github.com/morluto/rea) to the existing Viral Hit harness. The bridge supports static analysis of a JavaScript/Electron artifact and bounded observation of one already-open browser target. It produces an evidence summary in **Runs**, with a JSON download and a companion skill for turning findings into a feature map and reconstruction plan.

This is an integration with **rea-agents 6.8.0**, not a replacement REA implementation. REA is MIT licensed and installed separately. The default studio installs no REA, browser, native disassembler or language model. The question guides the companion agent's interpretation; it does not change REA's deterministic capture into a semantic feature analysis.

## Build and install

Use macOS or Linux. Install REA separately with a Node version supported by its pinned release: ^22.23.4, ^24.22.1 or >=26.12.1. Version 24.22.1 was used for verification. Follow [REA's documentation](https://github.com/morluto/rea); agent setup, native engines and optional instrumentation are unnecessary for this bridge.

From this directory:

```sh
npm ci --ignore-scripts
npm test
npm run build
```

Build outputs:

| File | Import destination |
|---|---|
| `dist/rea.runtime.json` | Extensions → Manage runtime packages |
| `dist/rea.pack.json` | Runs → Recipe library → import pack |
| `dist/rea.skill.json` | Skills → import skill |

Review and install the runtime through the [existing package workflow](../../docs/RUNTIME-PACKAGES.md). Alternatively copy the paired files in `dist/adapters/` into the operator's existing adapter directory, preserving other adapters. Do not install the same operation through both routes. Recipe and skill installation alone does not install executable code.

Set these server-side variables in every studio, MCP and worker process, then restart those processes together:

```sh
export VIRAL_HIT_REA_NODE=/absolute/node-install/bin/node
export VIRAL_HIT_REA_CLI=/absolute/rea-install/node_modules/rea-agents/scripts/rea.mjs
export VIRAL_HIT_REA_CLI_SHA256=<sha256-of-that-entry-file>
export VIRAL_HIT_REA_TARGETS=/absolute/private-config/rea-targets.json
export VIRAL_HIT_REA_EVIDENCE_DIR=/absolute/private-evidence/rea
```

Calculate the CLI entry hash with `shasum -a 256 /absolute/path/to/rea.mjs`. Keep the whole Node/REA installation immutable while jobs exist. The bridge checks the entry hash and package name/version, **not the entire dependency tree or Node binary**. The existing harness pins configuration values; the bridge additionally snapshots target-catalog bytes at submission and verifies that identity before retaining/recovering a result. Use a new immutable catalog path for target changes. The website and source files themselves can change; evidence describes the capture time.

## Register a target

The operator creates a JSON catalog of up to 32 targets. Inputs from the UI contain only a registered ID and a question.

```json
{
  "schemaVersion": 1,
  "targets": [
    {
      "id": "example-app",
      "label": "Extracted example app",
      "kind": "javascript",
      "path": "/absolute/extracted-app-or-asar"
    },
    {
      "id": "example-web",
      "label": "Example search page",
      "kind": "website",
      "endpoint": "http://127.0.0.1:9222",
      "origin": "https://example.com",
      "targetId": "ACTUAL_TARGET_ID_FROM_THE_BROWSER"
    }
  ]
}
```

For websites, provide an independently started browser with a loopback CDP endpoint. Obtain the exact page ID from its `/json/list` response. Open the intended page and perform any desired interaction yourself before analysis; the bridge does not launch, navigate or click a target. The allowed origin must exactly match the page. Earlier network activity may be absent because REA observes a bounded attachment window.

Choose **Inspect a website** or **Inspect a JavaScript or Electron app** in Runs, enter the registered target ID and one feature question, review the plan, then run. Open the completed report. Static API and route candidates need behavior verification; names alone do not establish purpose. Use the companion skill in a connected agent to produce the feature map, unresolved questions, input/output contract and implementation tests.

## Bounds and recovery

One engine runs per evidence directory, enforced by an exclusive lock. There is no background engine or second queue. A CLI invocation has a 90-second deadline, 8 MiB combined output limit and 512 MiB V8 heap limit; source-analysis children use a 256 MiB V8 heap limit. Web bundle analysis has a 45-second analysis budget; the whole harness call has a 200-second deadline. These are not total RSS or aggregate disk quotas. Large targets can exceed limits and return partial evidence. The public UTF-8 summary is capped at 96 KB; omitted observations remain in retained evidence.

Child processes inherit only an isolated HOME/TMPDIR, minimal PATH, locale and color setting. They do not inherit provider credentials. This is process isolation, not an OS sandbox: REA still runs as the operator. Website capture can retain sensitive page data; private evidence files use mode 0600 and new directories 0700. Summaries can still contain inspected identifiers and source paths, so review before sharing.

An intent is written before capture. Completed receipts reconcile by reading retained files without reobserving the target. An incomplete intent remains uncertain and cannot silently rerun. A missing or changed completed result also becomes uncertain. Cancellation stops the process group; completed evidence can survive cancellation. After a host crash, inspect `.analysis-lock/owner.json`, confirm the original process is gone, then remove only the stale lock. Retain incomplete intents while deciding whether to create a fresh run. Evidence has no automatic expiry; operators own retention and disk cleanup.

## Verification

`npm test` uses a protocol fixture for boundaries, output limits, cancellation, configuration changes, project scope, recovery and partial reports. It does not prove REA's analysis quality.

For live verification, build the extension, create a configuration JSON containing the four `VIRAL_HIT_REA_NODE`, `VIRAL_HIT_REA_CLI`, `VIRAL_HIT_REA_CLI_SHA256` and `VIRAL_HIT_REA_TARGETS` values, then run:

```sh
pnpm --dir apps/studio exec tsx scripts/verify-rea.ts \
  /absolute/configuration.json /absolute/evidence-directory example-app example-web
```

The verifier uses a new isolated data directory, validates the runtime/pack/skill through their real application contracts, installs the data definitions there, runs actual REA through the existing harness and verifies retained evidence IDs/hashes. It writes a result and preview environment. It never installs into the main workspace.

Native binary analysis, automatic interaction tracing, server-only source recovery and automatic reconstruction are outside this first bridge. The initial implementation provides evidence collection and an agent workflow, not feature parity with an inspected product.

### Recorded checks: 2026-10-28

- Actual REA 6.8.0 / Node 24.22.1 ran through the Viral Hit harness against a local JavaScript fixture, a local Chromium target and Higgsfield's public homepage. Evidence IDs and retained-file SHA-256 hashes matched.
- Local JavaScript produced 13 summary findings; local web produced 3; Higgsfield produced 50, including page links and same-origin script metadata. These counts describe retained observations, not implemented features. Web reports remain partial because capture policies and analysis coverage exclude content; no logged-in generation flow or server implementation was tested.
- Nine extension tests and 926 studio source tests passed, as did architecture, typecheck, i18n, production build and the documented browser performance allowance.
- Real browser checks verified three reports, partial labels, report download identity, recipe/target selection and no horizontal overflow at 1440×960 and 390×844. The visual rubric passed at both sizes. Raw captures and browser/source data remain ignored local evidence.
