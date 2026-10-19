# Extending Viral Hit

The core must support both general creative work and specialized workflows. A new use case must not require forking the editor or inheriting advertising-specific assumptions. There are two extension levels: **data recipes** (implemented) and **execution adapters** (a TypeScript interface implemented in source; dynamic package installation is pending).

## Add a recipe without editing application code

A recipe is a versioned JSON file with identity, author/license, category, typed parameters, nodes and bindings. Put a manifest in `recipes/`, or point `VIRAL_HIT_RECIPES_DIR` to your own manifest directory before starting the app/MCP server. The studio reads the catalog and builds the input form from each manifest. Agents discover the same catalog through `viral_hit_recipes_list`; `viral_hit_runs_change` accepts `action: "recipe"`, `recipeId`, `values` and a stable `requestKey`.

The shipped `open-frame` recipe is general-purpose. `editorial-triptych` specializes the same machinery for three directed frames. It does not promise character continuity or automatic film assembly. Add product photography, storyboards, animation keyframes or other recipes without changing core UI components. Each recipe must describe real operation coverage accurately.

Manifests do not execute JavaScript, shell commands, environment expressions or agent instructions. Required operations must exist in the installed runtime. The current web worker supports `comfy.router`. An unknown operation fails before submission. Model schemas and costs still require provider validation; a new model name in JSON is not a verified integration. Native Router output URLs remain temporary until media localization is implemented.

The [JSON Schema](schemas/recipe.schema.json) supports editor tooling. The runtime compiler additionally verifies graph cycles, parameter types/ranges, duplicate identifiers, pointer safety, dependency membership and overlapping bindings. Root `schemaVersion` versions the manifest format; recipe `version` versions the author's behavior. Node operation version and recipe identity/version enter the execution fingerprint.

```sh
# From repository root: compile offline, without API credentials or paid calls.
pnpm --silent --dir apps/studio recipe compile ../../recipes/open-frame.json ../../examples/open-frame-values.json MY_PROJECT_ID > /tmp/viral-hit-plan.json
# Inspect the plan before using the harness enqueue command.
pnpm --dir apps/studio harness enqueue /tmp/viral-hit-plan.json stable-request-key
```

## Typed parameter and output binding

A node starts with a JSON `input` and existing placeholders. Its `parameters` map a declared recipe parameter to an input JSON pointer:

```json
{
  "input": { "model": "bfl/flux-2-pro", "body": { "prompt": "" } },
  "parameters": [{ "parameter": "prompt", "target": "/body/prompt" }]
}
```

The compiler copies typed values, without string interpolation or evaluation. Parameters can be string, finite number, boolean or an enumerated string. Unknown values and invalid defaults fail validation.

For multi-stage processing, `bindings` select output JSON from an explicitly declared upstream node. The following is a **contract example**, not a live claim about a particular model's result format:

```json
{
  "id": "animate",
  "operation": "custom.video",
  "version": "1",
  "input": { "image": null },
  "dependsOn": ["frame"],
  "bindings": [{ "target": "/image", "node": "frame", "pointer": "/asset" }]
}
```

Once dependencies succeed, the worker resolves the pointers and persists the exact execution input **before** submission. Restart, replay, polling and cancellation reuse that frozen input. Missing fields fail before any dependent provider call. JSON pointer escaping follows `~0` and `~1`; array entries are indexed explicitly. Bindings may replace existing values, not create prototype properties or expand arrays. Cache invalidation includes upstream inputs and binding definitions. Generated media caching remains disabled until durable files are verified.

## Add an execution adapter in source

Implement `Adapter` in `apps/studio/src/core/harness/durable.ts`: `submit`, `poll`, optional `cancel`, and a truthful `recovery` mode. Register it in the worker and define its validated request policy. `submit` receives a persisted idempotency key, dependency outputs and an AbortSignal. It must return the real external job ID. `poll` returns actual running/succeeded/failed/canceled status; cancellation must not invent provider confirmation.

Use `recovery: "replay"` only if repeated submission with the same key is guaranteed to recover the original job. Otherwise use `manual`, leaving ambiguous outcomes uncertain. Persist provider identity, model/version, actual cost (or null), output metadata and provenance. Do not return success merely because an HTTP request was accepted.

Third-party executable adapters run with local process privileges; a future installer must make that explicit and must not auto-install code from a recipe. Signed packages, an adapter capability registry, isolated workers and schema-driven model discovery remain planned. Today this is a reviewed source contribution, not a plugin marketplace.

## Contributing

Keep general project/asset/timeline contracts free of brand-specific fields. Specialized parameters belong in recipes or optional metadata. Reuse public source only with compatible license/provenance and update `THIRD_PARTY_NOTICES.md`. Preserve existing MCP names when extending the catalog; new Viral Hit tools use `viral_hit_*`.

Validate changes at the affected boundary. Provider logic needs timeout/restart/ambiguous-response tests. Editor changes need real imported media, a decoded export and visual inspection. A model-quality claim needs real paid/open-weight generation evidence, not fixtures. Do not mark broad parity areas complete from narrow tests. Document missing functionality and failed comparisons alongside successful ones.
