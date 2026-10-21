# Extending Viral Hit

The core must support both general creative work and specialized workflows. A new use case must not require forking the editor or inheriting advertising-specific assumptions. There are two extension levels: **data recipes** (implemented) and **execution adapters** (explicitly installed, versioned server modules shared by the UI, MCP and worker).

## Discover independent catalogs

[Community catalogs](COMMUNITY.md) let anyone host a searchable list of general or specialized skills, recipe packs and creative packs in their own repository. Add a catalog in the studio, review its metadata, then open an entry in its library with its raw-file checksum. Discovery installs and runs nothing.

## Share several recipes as a pack

Group related recipes into a [recipe pack](PACKS.md) labeled general or for a specific job. Packs install all at once after review, appear grouped in the Runs picker, and are shared through the same UI, HTTP, MCP and CLI service.

## Add a recipe without editing application code

A recipe is a versioned JSON file with identity, author/license, category, typed parameters, nodes and bindings. Import a manifest through **Runs → Recipe library**, put one in `recipes/`, or point `VIRAL_HIT_RECIPES_DIR` to your own file catalog before starting the app/MCP server. The configured directory replaces the shipped file catalog; the workspace’s separate local library is appended without shadowing file-catalog IDs. The studio reads the catalog and builds the input form from each manifest. Agents discover the same catalog through `viral_hit_recipes_list`; `viral_hit_runs_change` accepts `action: "recipe"`, `recipeId`, `values` and a stable `requestKey`.

The shipped `open-frame`, `open-motion` and `spoken-line` recipes cover general image, video and speech workflows. `remote-media-import` imports public HTTPS image/video/audio media without a generation key. `editorial-triptych` specializes the same machinery for three directed frames. It does not promise character continuity or automatic film assembly. Add product photography, storyboards, animation keyframes or other recipes without changing core UI components. Each recipe must describe real operation coverage accurately.

Manifests do not execute JavaScript, shell commands, environment expressions or agent instructions. Required operations must exist in the installed runtime. The current web worker supports `comfy.router`, `comfy.workflow`, `comfy.upload`, `asset.materialize` and explicitly installed `ext.*` adapters. See [external runtime installation](EXTERNAL-ADAPTERS.md). An unknown operation fails before submission. Model schemas and costs still require provider validation; a new model name in JSON is not a verified integration. Native Router output URLs remain temporary; an explicit `asset.materialize` node saves persistent local bytes. The shipped image recipes declare the FLUX response URL at `/data/result/sample`, following the official Comfy cinematic example. The shipped video recipe maps the Kling task-list result at `/data/data/0/outputs/0/url`; other result shapes need their own mapping. It does not currently fall back to a watermark URL. Each other model requires its own declared output mapping.

Asset parameters declare `kind: image | video | audio`; installed adapters can consume verified local bytes through declared [project media inputs](EXTERNAL-ADAPTERS.md#project-media-inputs). Inputs can also come from explicit upstream materializer nodes, allowing generation and processing recipes to compose.

The [JSON Schema](schemas/recipe.schema.json) supports editor tooling. The runtime compiler additionally verifies graph cycles, parameter types/ranges, duplicate identifiers, pointer safety, dependency membership and overlapping bindings. Root `schemaVersion` versions the manifest format; recipe `version` versions the author's behavior. Node operation version and recipe identity/version enter the execution fingerprint.

```sh
# From repository root: compile offline, without API credentials or paid calls.
pnpm --silent --dir apps/studio recipe compile ../../recipes/open-frame.json ../../examples/open-frame-values.json MY_PROJECT_ID > /tmp/viral-hit-plan.json
# Inspect the plan before using the harness enqueue command.
pnpm --dir apps/studio harness enqueue /tmp/viral-hit-plan.json stable-request-key
```

## Import, fork and share recipes in the studio

Open **Runs → Recipe library**. **Import JSON file** accepts a Viral Hit recipe manifest up to 128,000 bytes; the JSON editor also accepts pasted content. **Duplicate & edit** copies the selected recipe into a new ID and resets its version to `1.0.0`, preserving its author, license, graph and parameters. Edit the JSON to specialize it, then **Inspect JSON**. The report shows identity, attribution, node/input counts, required operations and ID collisions. It validates the manifest, defaults, dependency graph and binding pointers offline. It does not call a provider, upload inputs, install code/models or submit a workflow.

**Install recipe** binds the write to the inspected content digest. Editing the JSON clears that review. Installed recipes immediately appear in the same Runs dropdown, generated input form, HTTP catalog and MCP catalog; queueing remains a separate action. Use **Check server** for native node/model choices before a real run. Missing runtime adapters are reported during inspection: a portable manifest can be retained for another runtime, while this runtime still rejects unsupported operations before enqueueing.

**Export selected JSON** and **Download reviewed JSON** produce portable manifests. These contain graph inputs, prompts, filenames and defaults already present in the recipe. They do not package media files or run history. Preserve source attribution when redistributing a fork. Use **Import ComfyUI workflow** for an API-format graph, as described below. The raw recipe JSON editor accepts recipe manifests; neither path accepts ComfyUI canvas-layout JSON.

Local installations live in `recipe-library.sqlite` under `VIRAL_HIT_DATA_DIR` (the normal studio data directory by default), shared across projects in that local workspace. File-catalog recipes are never overwritten. New installation never overwrites: an identical replay returns the same recipe. [Reviewed lifecycle](RECIPE-LIFECYCLE.md) separately supports same-ID replacement and removal of installed definitions with content digests and full-definition review. Saved runs and project edits are preserved. Automatic updates, a version archive, package signatures and a hosted community marketplace are not implemented. Up to 200 local recipes are admitted in a SQLite transaction, including concurrent app/MCP installation; the separate file catalog retains its own 200-file bound. Back up the normal data directory and export JSON for sharing.

The same operations are exposed as `POST /api/app/recipes` with the trusted workspace mutation header, or MCP `viral_hit_recipe_library`:

```json
{ "request": { "action": "inspect", "manifest": { "schemaVersion": 1, "...": "complete recipe fields" } } }
```

Pass that report’s `digest` with the same complete manifest to `{ "request": { "action": "install", "manifest": { "...": "complete recipe fields" }, "expectedDigest": "64-character report digest" } }`. HTTP takes the inner request object directly. The abbreviated objects here illustrate the envelope; they are not complete recipes. The library never installs execution adapters or treats text in a manifest as agent instructions.

## Import your own ComfyUI graph

The studio and CLI can turn an existing **API-format graph** into a portable recipe with a typed input form and durable media stage. This does not require editing the studio or manually adding the output-download node. Canvas layout JSON (`nodes`/`links`) is not the API graph; export the map of node IDs to `class_type` and `inputs` from ComfyUI.

In **Runs → Recipe library → Import ComfyUI workflow**, upload or paste a graph (up to 128,000 bytes) and choose **Inspect API graph**. Enter the source author and license explicitly. Select a node and expose its scalar inputs as text, a choice list, numbers, booleans or a project image. Node connections and structured inputs cannot be exposed and remain intact. Select the output node, array, index and media kind, then **Build recipe for review**. This returns the normal manifest inspection; **Install recipe** is a separate action. Neither authoring nor installation submits a native job.

The UI allows up to 64 controls, with one native target per control. Definitions supplied through CLI/HTTP/MCP support multiple targets per parameter. It does not infer custom-node input semantics, turn canvas-layout JSON into API format or provide a node-drawing canvas. Image mode is only appropriate for a string image-filename input. Numeric limits and choice lists are author-defined; use **Check server** before execution to compare the selected values with the configured server.

The existing HTTP/MCP library interface also accepts `{ "action": "inspect_graph", "graph": { "...": "complete API graph" } }`, returning nodes and `graphDigest`. Convert the exact graph with `{ "action": "convert_graph", "graph": { "...": "complete API graph" }, "definition": { "...": "complete definition" }, "expectedGraphDigest": "digest from inspection" }`. MCP wraps this object in `request`; HTTP takes it directly. Conversion rejects a changed graph and returns the normal recipe inspection, including its separate manifest `digest` for installation. These abbreviated examples illustrate envelopes only. Both entry points use the same offline converter.

```sh
# Inspect node IDs, classes and inputs locally; no server or provider call.
pnpm --silent --dir apps/studio recipe inspect-comfy ../../examples/comfy-api-canvas.json
# Install the example recipe into the default catalog; refuses to overwrite an existing file.
pnpm --silent --dir apps/studio recipe import-comfy ../../examples/comfy-api-canvas.json ../../examples/comfy-canvas-definition.json ../../recipes/my-imported-canvas.json
```

Open Runs and select **My imported canvas**. The catalog is read on request; reopen Runs to refresh it. With the [native server configured](LOCAL-COMFYUI.md), queue the workflow, then use **Add to timeline** after materialization succeeds. If `VIRAL_HIT_RECIPES_DIR` points elsewhere, write the generated manifest to that directory instead. It replaces the default file-catalog location; locally installed library recipes remain available alongside it. The shipped example is a solid-color canvas without model weights; replace the graph and definition with your own workflow to use installed models or custom nodes.

The [definition example](../examples/comfy-canvas-definition.json) supplies identity, version, author, license, output selection and exposed inputs. A [definition JSON Schema](schemas/comfy-recipe-definition.schema.json) supports editors. Each entry contains a normal recipe `parameter` plus one or more `targets` with `nodeId` and input name. One parameter can drive several native nodes—for example, a shared prompt. For scalar parameters, an omitted default comes from the first target; explicit defaults take precedence, including `false`, `0` and empty strings (the latter require `minLength: 0`). The first target's default is applied to every target during compilation. Unexposed inputs and all node connections are retained.

Only existing scalar string, number and boolean inputs can be exposed; enums bind string inputs. The importer rejects connection arrays, structured inputs, mismatched types, duplicate/overlapping bindings, invalid defaults and manifests exceeding the catalog's 128 KB limit. It preserves supported node title metadata and treats text as literal data. Failed validation creates no manifest. Existing destination files, including a source graph passed accidentally as the destination, are never overwritten.

Select the actual output node, output array (`images`, `audio`, `gifs` or `videos`), zero-based index and expected media `kind`. Import does not discover server node contracts, install nodes/models, execute uploads, or establish that a custom node produces that output. Native ComfyUI validates its installed-node requirements at submission; the existing materializer checks returned media. Imported workflows keep their author's license—do not relabel third-party graphs as Viral Hit code. Review graph content before sharing a recipe, including embedded prompts and filenames.

### Project images as workflow inputs

Declare an imported parameter as `{ "id": "source", "label": "Source image", "type": "asset", "kind": "image" }`, targeting the string filename input of a native node such as `LoadImage`. The importer inserts a `comfy.upload` stage and binds its returned filename into the graph. One image parameter can feed several nodes. Image parameters never inherit a native filename as a default project asset ID: the user selects a project image in Runs. See [resize graph](../examples/comfy-api-resize.json), [definition](../examples/comfy-resize-definition.json) and the generated [recipe](../recipes/local-image-resize.json). This pattern also supports image-conditioned custom graphs when their required nodes and models are installed; the resize example does not prove those models' quality.

The UI previews the selected image and explains that it will be sent to the configured ComfyUI server. Selection currently reads the first 500 project assets, filters for local PNG/JPEG/WebP images up to 32 MiB, and refreshes when Runs is reopened. MCP/CLI can specify any valid project asset ID directly. Remote-only assets must first be localized. Video/audio input transfer and masks are not implemented by this image adapter.

HTTP, MCP and harness CLI enqueue paths validate membership and bytes, then persist the image SHA-256 and configured-server fingerprint in the plan. The worker rechecks both before sending anything. Missing, modified, cross-project and unpinned sources are rejected. A separate upload node uses a project-scoped, content-addressed filename and `overwrite=false`. A lost upload response can repeat the same upload without repeating workflow submission. This relies on the checked native ComfyUI duplicate-byte behavior; a server returning a different filename fails validation. Uploaded files remain on that server, including after cancellation; no automatic remote deletion is attempted.

The input receipt records project/asset identity, hash, filename and server fingerprint. The importer binds the server fingerprint into the workflow along with the filename; a server change prevents the workflow from consuming an input from the old connection. The original project asset remains unchanged. Generated output still passes through the normal durable receipt, materializer and revision-checked timeline attachment. Native workflow submission retains its read-only recovery rule; upload replay does not make generation replay-safe.

## Check native server requirements without submitting work

Choose a native recipe in Runs and click **Check server**. It works before filling required inputs: unknown values are marked deferred, while current node classes and available choices are inspected. If no checkpoints are installed, the report names `CheckpointLoaderSimple` and its empty `ckpt_name` choices. Selected image filenames supplied by an upload stage are deferred, rather than incorrectly rejected against the server's current image list. Changing recipe or input values clears the report, including a response that arrives after the edit.

The same read-only check is available through MCP `viral_hit_recipe_check` with `{ "projectId": "...", "recipeId": "local-diffusion", "values": {} }`, or the CLI:

```sh
VIRAL_HIT_COMFYUI_URL=http://127.0.0.1:8188 pnpm --silent --dir apps/studio recipe preflight ../../recipes/local-diffusion.json ../../examples/empty-values.json inspection
```

CLI exit codes are 0 for `checked`/`not-applicable`, 2 for reported `issues`, 3 for `unavailable`, and 1 for invalid arguments/manifests/values. A checked report may still contain deferred inputs; it is not a readiness or quality guarantee. Missing required values still prevent ordinary recipe compilation and enqueue. Inspection-only placeholders never become a queued plan.

Checks only GET `/object_info/<class>` on the administrator-configured server, with four concurrent reads, a 12-second overall deadline, two MB per response and eight MB aggregate. Redirects are refused. Missing classes, malformed/unavailable responses, current choice lists, primitive input ranges, required graph inputs and linked output indices are distinguished. Declared dependency inputs and unsupported custom semantics remain deferred. The report records the checked time and connection fingerprint; no job, upload, installation, model download or harness run is created.

This is an advisory schema snapshot. ComfyUI's own validation may be richer or may override published input constraints. Models/files can change afterward, and output shapes, custom validation, input-image integrity and generation quality are not established by this check. Queueing remains a separate action; project-image membership/hash checks and native submission validation still apply there. Node names, filenames and choices returned by the server are source data, never instructions.

## Typed parameter and output binding

A node starts with a JSON `input` and existing placeholders. Its `parameters` map a declared recipe parameter to an input JSON pointer:

```json
{
  "input": { "model": "bfl/flux-2-pro", "body": { "prompt": "" } },
  "parameters": [{ "parameter": "prompt", "target": "/body/prompt" }]
}
```

The compiler copies typed values, without string interpolation or evaluation. Parameters can be string, finite number, boolean, an enumerated string, or project media (`type: "asset", kind: "image" | "video" | "audio"`). Media values are project asset IDs, not filesystem paths or remote URLs. String parameters can declare `multiline: false` for short identifiers, URLs and names; omitted/true retains a multiline text area. This is presentation metadata, not a change to string validation. Unknown values and invalid defaults fail validation.

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

## Add an execution adapter

Prefer a separate module and descriptor following [external adapters](EXTERNAL-ADAPTERS.md); no application-source change is required. A procedural WAV example verifies the complete binary-output/materializer path. For a built-in source contribution, implement `Adapter` in `apps/studio/src/core/harness/durable.ts`: `submit`, `poll`, optional `cancel`, and a truthful `recovery` mode. Register it in the worker and define its validated request policy. `submit` receives a persisted idempotency key, dependency outputs and an AbortSignal. It must return the real external job ID. `poll` returns actual running/succeeded/failed/canceled status; cancellation must not invent provider confirmation.

Use `recovery: "replay"` only if repeated submission with the same key is guaranteed to recover the original job. Otherwise use `manual`, leaving ambiguous outcomes uncertain. Persist provider identity, model/version, actual cost (or null), output metadata and provenance. Do not return success merely because an HTTP request was accepted.

Third-party executable adapters run with local process privileges. Operators explicitly configure their directory; recipes cannot install code. The shared capability catalog includes installed operations, configuration availability, version, attribution, recovery mode and input schema. Signed packages, isolated workers, automatic model discovery and a hosted plugin marketplace remain planned.

## Source-level model catalog extensions

The editor's model picker consumes pure metadata from `src/config/generation-catalog.ts`; executable provider definitions register separately in `src/config/generation-providers.ts`. Define one browser-safe metadata object and compose it into the server definition. The server rejects mismatched metadata. Keep credentials, SDK clients and database access in the server implementation. Select the active source provider in the catalog config. See [the boundary decision](architecture/001-public-generation-catalog.md). This source-level hook is separate from independently installed harness adapters described above.

## Contributing

See [CONTRIBUTING.md](../CONTRIBUTING.md) for where a contribution belongs and how to propose a pack. Pack, recipe and sequence files can be checked against [pack.schema.json](schemas/pack.schema.json), [recipe.schema.json](schemas/recipe.schema.json) and [sequence.schema.json](schemas/sequence.schema.json).

Keep general project/asset/timeline contracts free of brand-specific fields. Specialized parameters belong in recipes or optional metadata. Reuse public source only with compatible license/provenance and update `THIRD_PARTY_NOTICES.md`. Preserve existing MCP names when extending the catalog; new Viral Hit tools use `viral_hit_*`.

Validate changes at the affected boundary. Provider logic needs timeout/restart/ambiguous-response tests. Editor changes need real imported media, a decoded export and visual inspection. A model-quality claim needs real paid/open-weight generation evidence, not fixtures. Do not mark broad parity areas complete from narrow tests. Document missing functionality and failed comparisons alongside successful ones.


## Durable media stage

`asset.materialize` takes `{ "url": "", "kind": "image", "label": "Opening frame" }`, with a URL filled by a dependency binding or a user parameter. It requests HTTPS media from public addresses only, pins resolved DNS to the connection, rechecks redirects, forwards no auth/cookies, bounds downloads to 512 MiB and obeys cancellation/time limits. Private/self-hosted media needs an explicit future provider bridge; arbitrary localhost download is not enabled by a recipe.

FFprobe validates supported raster/container types, dimensions, stream presence and duration. This is not exhaustive decoding or a quality rating. A stable asset ID derives from project and job key. Bytes are published without overwriting an earlier artifact, hashed, registered and linked to the project. A restart between file publication and database linkage reuses the file. The paid provider job is a separate DAG node, so retrying local import does not resubmit generation. The original provider receipt remains immutable; the local job returns its own asset record with SHA-256, size, type, duration and local project URL.

`viral_hit_runs_change` action `attach` accepts `runId`, `jobId` and `expectedRevision`. It only accepts successful, uncanceled local-import jobs in the selected project, rechecks file integrity and applies one stable `add_clip` command. It never replaces the entire timeline. Repeated attachment returns the same command receipt; stale revisions fail. The UI fetches the timeline revision before requesting this action.

`viral_hit_runs_change` and the project `/runs` HTTP endpoint also accept action `take` with `runId`, `jobId`, `clipId` and `expectedRevision`. This is a generic materializer-to-editor bridge, independent of recipe or provider. It adds and activates a same-kind image/video/audio alternative in one `editor.apply` revision. The source is hash-checked again; target position, length, original trim, transforms, fades and neighboring clips remain unchanged. New video/audio starts at source time zero and must cover the target duration; images use the existing scene duration. Locked tracks and incompatible media are rejected. Image overlays use the same mechanism.

Runs → **Use as take** loads a target/revision snapshot, then **Apply take** submits it; it does not silently refresh a stale revision at submission. Reopen **Use as take** after an intervening edit to inspect fresh targets. In the editor, **Clip take** switches between alternatives and **Original**, including on mobile. Each job/clip pair imports once, and a replay returns its original command receipt without reactivating a take the user has since deselected. To select an existing take again, use the editor selector or `activate_take`, rather than repeating the import. This action changes the selection explicitly; it is not an automatic creative-quality acceptance decision.

Take objects carry optional `sourceType`; absent values mean legacy video takes. Direct `add_take` commands must declare `sourceType` for image/audio. Project ownership and actual asset type are checked at the command boundary, and the clip must match that type. Preview, browser export and server export resolve the active take.

The default image duration on attachment is three seconds; imported video/audio uses the probed duration. Supported initial containers include PNG/JPEG/WebP/GIF, MP4, WebM, MP3, WAV and Ogg. Expired provider-URL refresh, cross-run media cache validation, automated per-shot quality acceptance, background repair and full decoding still need work. A canceled import can retain an already published asset for audit; its run is not eligible for automatic attachment.

Evidence for the FLUX mapping: [official Comfy cinematic example](https://github.com/Comfy-Org/comfy-cinematic-studio/blob/main/lib/flux-output.ts). Download address classification uses the [ipaddr.js public API](https://github.com/whitequark/ipaddr.js) pinned at 2.5.0.

## Video and speech contracts

`open-motion` exposes a prompt, 16:9/9:16/1:1 framing, integer duration 3–15 seconds and 720p/1080p settings using `kling/kling-3.0-turbo`. `spoken-line` uses `elevenlabs/eleven_v3` with the model-specific `inputs: [{text, voice_id}]` body and a stability setting. There is no fixed brand, narrator, language, advertising format or required aspect ratio in the engine. Voice IDs are supplied by the user; provider access and model capabilities still apply.

These contracts were read from the public [Kling schema](https://docs.comfy.org/router-schemas/kling/kling-3.0-turbo.json) and [Eleven v3 schema](https://docs.comfy.org/router-schemas/elevenlabs/eleven_v3.json). Schema version and SHA-256 are pinned in [model-contracts.json](../research/model-contracts.json). The model-specific schema takes precedence over a generic SDK example. The checked Eleven v3 route uses dialogue inputs, rather than a top-level `text` property. Input-contract inspection and fixture execution do not establish real provider acceptance or generation quality.

For binary-returning models, bind the provider node's `/binaryReceipt` to a materializer input's `/receipt`:

```json
{
  "id": "voice-asset",
  "operation": "asset.materialize",
  "version": "1",
  "cache": false,
  "input": { "receipt": null, "kind": "audio", "label": "Narration" },
  "dependsOn": ["voice"],
  "bindings": [{ "node": "voice", "pointer": "/binaryReceipt", "target": "/receipt" }]
}
```

Use either `url` or `receipt`, never both. The resolved receipt is an opaque job ID plus hash; recipes cannot supply local paths or another project's ID. Binary results are retained before the provider job is marked successful. The materializer verifies and copies them into normal Assets, then the existing revision-checked attachment adds video to a visual track or audio to an audio track. Extending the same pattern to music, effects or other binary models still requires a verified native input contract and a supported output container.

## Editable workflow output

Use the built-in [`editor.sequence`](EDITABLE-SEQUENCES.md) step to prepare separate timeline clips from project assets or preceding materializers. It shares the normal worker and explicit revision-checked attachment, while keeping rendering and user acceptance separate. The portable sequence schema and two example recipes support general planners and specialized workflows.

Installed recipe-only packs can publish same-ID releases through [reviewed pack lifecycle](PACK-LIFECYCLE.md). Updates add missing members, selectively replace chosen definitions and preserve dropped recipes; removal keeps recipes unless explicitly selected. This uses the shared library service across UI, MCP and CLI.

[Creative packs](CREATIVE-PACKS.md#update-remove-and-recover-releases) maintain combined recipes, skills and characters through reviewed same-ID releases. Select replacements, preserve local edits, export retained releases by digest, and remove the bundle listing while keeping reusable contents. Executable runtime modules remain a separate explicit installation boundary.

[Managed runtime packages](RUNTIME-PACKAGES.md) combine independent providers, workflow adapters and publishing connectors without editing the studio. CLI/MCP/HTTP support full-source review, atomic desired-state installation/update/removal and retained release restoration. Activation requires coordinated process restart; the existing runtime owners execute the reviewed code.

## Add an analysis model

[Independent analysis providers](ANALYSIS-PROVIDERS.md) use the existing provider module/manifest boundary for general review or specialized one-video text reports. They share Canvas selection, HTTP/MCP descriptors, generation records and polling. The optional [technical inspector](../examples/providers/media-inspector/README.md) runs FFprobe without a model service; semantic analysis requires a suitable independently implemented engine.


## Local model inputs

Installed generation providers can opt into `referenceDelivery: "project-media"` to consume verified project files through `readMedia`, without a cloud upload dependency. Use the same contract for general models and specialized processors. See [local provider media](architecture/LOCAL-PROVIDER-MEDIA.md) for limits, reader lifetime, queued-job behavior and the trust boundary. The optional [technical inspector](../examples/providers/media-inspector/README.md) is a standalone implementation using this interface.
