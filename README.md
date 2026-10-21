# VIRAL HIT

An independent, general-purpose open-source creative studio. Direct images, films, animation, sound and edits from one project — with a durable agent harness underneath.

**Status: active development, not Higgsfield feature or performance parity.** See [parity plan](docs/PARITY.md) and [research](research/README.md). Do not confuse an upstream claim or a working UI with validated generation quality.

## Scope

Image/video/audio generation, cinematic direction, consistent characters, motion transfer, object replacement, editable layers, connected canvas, multitrack video editing, reference-driven edits, agent tools, templates, collaboration and publishable project provenance. Ads are one application, not the scope limit.

## Repository

- `apps/studio/`: visual canvas, shared assets, timeline, preview and export.
- `apps/studio/src/core/harness/`: new durable execution queue and Comfy Router adapter.
- `research/upstream-lock.json`: inspected repositories with exact commits and source URLs.
- `research/upstream/`: ignored, unmodified local research checkouts, including private reference pipeline material.
- `research/evidence/`: ignored browser evidence. Logged-in browser details are never published.
- `docs/`: architecture, benchmark protocol, and feature-by-feature acceptance criteria.

Do not copy brand assets, private data or credentials into the public product.
`Viral Hit` is a working title.
## Run

Requires Node 24+, pnpm 10, and FFmpeg/ffprobe. From this directory:

```sh
pnpm run setup
pnpm dev
```

Open `http://127.0.0.1:3808/projects`. Local import, editing and MP4 export need no generation key. Comfy execution requires your server-side `COMFY_API_KEY` and provider credits. Built-in image, video and speech recipes separate provider generation from durable media import, then offer revision-checked timeline attachment. Actual paid Comfy Router generation has not yet been validated; the separate native ComfyUI path has a real model-free execution check.

Read [architecture and setup](docs/ARCHITECTURE.md), [reference pipeline extraction](docs/REFERENCE-PIPELINE.md), [validation evidence](docs/VALIDATION.md) and [full parity targets](docs/PARITY.md). The validation ledger records source and browser checks, including a decoded 1080p MP4 export and actual model-free native workflows. They do not establish Higgsfield generation quality or performance parity.

## Extend it

Viral Hit is a general creative workspace with room for very specific workflows. The core stays general; anything tied to one format, brand, service or model lives in a layer you can add, fork or remove without changing the app.

| Layer | What it is | General examples | Situation-specific examples | Add your own |
|---|---|---|---|---|
| Core | Projects, assets, Canvas, timeline, durable harness, publishing, project files | Editing, export, MCP/CLI control | — | Pull request |
| Packs | Groups of recipes, labeled general or for a specific job, installed together | Editing basics | Short-form reel kit, Slide story kit | **Make a pack**, a file, or a GitHub link ([guide](docs/PACKS.md)) |
| Recipes | Versioned JSON workflows with typed forms, shared by UI and MCP | Open frame, Spoken line, Local diffusion on your ComfyUI | YouTube reference, Editable scene, Animated image story | Recipe library, `recipe import-comfy`, or a JSON file |
| Adapters | Independently installed execution engines | Audio gain, procedural tone | Your own model server or render farm | `VIRAL_HIT_ADAPTERS_DIR` ([guide](docs/EXTERNAL-ADAPTERS.md)) |
| Extensions | Optional runtimes with their own dependencies | Local media composition | ima2 images, YouTube intake | `extensions/<name>/` |
| Skills | Know-how an AI agent follows through MCP, labeled general or specialized | Recipe packs, Consistent characters | Product ad shots (example) | A folder in `VIRAL_HIT_SKILLS_DIR` ([guide](docs/SKILLS.md)) |
| Providers | Image and video models behind the Canvas, Studio and MCP generation | Cloud API (any compatible endpoint), Procedural images (example) | Your own model server, a brand-tuned model, an API Viral Hit does not ship | A folder in `VIRAL_HIT_PROVIDERS_DIR` ([guide](apps/studio/docs/PROVIDERS.md#install-a-provider-without-changing-the-app)) |

A workflow for one campaign or brand belongs in its own recipes and adapters, kept in a separate repository if it carries private rules or data. [CONTRIBUTING.md](CONTRIBUTING.md) explains where each kind of contribution goes and how to propose a pack. Project files move editable work between installations, so specialized setups can share results with general ones.

Install a versioned JSON recipe to add a workflow and its typed form without modifying the studio. UI and MCP discover the same recipes. [Extension guide](docs/EXTENDING.md) covers recipe authoring, output bindings, adapter contracts and current limits. Specialized recipes and general creative projects share the same core.

Native, self-hosted ComfyUI graphs are also supported through `comfy.workflow`: see [setup, recipes and recovery semantics](docs/LOCAL-COMFYUI.md). Import your own API-format graph in **Runs → Recipe library → Import ComfyUI workflow** or with `recipe import-comfy`; the [import guide](docs/EXTENDING.md#import-your-own-comfyui-graph) includes input/output mapping and an offline example. **Runs → Connections** saves and checks your native server address without editing code or restarting the worker; managed environment overrides remain read-only. Project image parameters add a previewable selection and durable transfer to your configured ComfyUI server; try **Resize a project image** in Runs. **Check server** inspects installed native nodes and current input/model choices without submitting work; the same check is available in CLI and MCP.

The interface now uses [SEED components and a light theme](docs/DESIGN.md), with an original [Viral Hit mark and wordmark](docs/BRAND.md). For local query debugging only, set `VITE_QUERY_DEVTOOLS=true`; the debug launcher is hidden by default.

Describe framing, angle, lens, camera move, light and look with [shot controls](docs/SHOT-CONTROLS.md), written as one editable line of the prompt.

Keep a person, mascot or product consistent with [characters](docs/CHARACTERS.md): reference images plus written rules, added to any project as reference assets and a prompt brief, or chosen in the Canvas composer to attach the main image to a draft. A character file carries one to another installation. UI, MCP and CLI share the same library.

Move an editable project between installations with a [project file](docs/PROJECT-FILES.md): original media, Canvas and timelines in one verified tar that always imports as a new project. UI, MCP and CLI share the same operations.

Unsaved timeline edits are backed up in the current browser. **Drafts** reviews and restores interrupted edits while preserving concurrent saved changes; see [editing recovery and storage limits](docs/EDITING-RECOVERY.md).

Install a new execution engine without editing the app: [external adapters](docs/EXTERNAL-ADAPTERS.md) share typed input discovery, pinned jobs, binary output receipts and editor integration. A standalone procedural WAV example is included; executable modules are enabled only by an operator-configured directory.

Optional [ima2 image recipes](extensions/ima2/README.md) connect a separately configured ima2 server for prompt-based and reference-guided image generation. Results enter the same project Assets and timeline. The bridge uses explicit provider/model selection and read-only recovery of interrupted requests; real provider quality validation remains pending.

Optional [local media recipes](extensions/local-media/README.md) compose project images, footage, music and narration into real videos. Fork a recipe to expose different controls or change the layout; generated assets can feed later composition steps without copying host paths.

Built-in [editable sequences](docs/EDITABLE-SEQUENCES.md) let any workflow prepare separate visual, overlay, music, voice and caption clips. Accept the edit after your current timeline, then change each part independently. The included image-story and narrated-scene manifests are forkable examples of the same contract.

Bring source videos into a project with [reference intake](docs/REFERENCE-INTAKE.md). Runs includes portable YouTube collection and project-video sampling recipes, with five frame previews and timeline attachment. CLI also accepts explicit Instagram direct-video items. Independent adapters can consume the resulting project video; automatic Instagram inbox collection remains pending.

Manage optional YouTube and Instagram connections from the workspace header or `/connections`. Operator-configured Google and Meta login keep credentials encrypted on the server; Instagram requires an explicit Page-linked account selection. Connecting does not publish. Each project now has a Publish screen for retained-video review, explicit revision-bound approval and delivery status, backed by a separate resumable upload worker. YouTube and Instagram Reels/video Stories share this flow. Instagram supports local scheduling; images/carousels and live-provider verification remain pending. See [publishing setup and status](docs/PUBLISHING.md).
