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

Open `http://127.0.0.1:3808/projects`. Local import, editing and MP4 export need no generation key. Comfy execution requires your server-side `COMFY_API_KEY` and provider credits. Built-in image, video and speech recipes separate provider generation from durable media import, then offer revision-checked timeline attachment. Actual live Comfy generation has not yet been validated.

Read [architecture and setup](docs/ARCHITECTURE.md), [reference pipeline extraction](docs/REFERENCE-PIPELINE.md), [validation evidence](docs/VALIDATION.md) and [full parity targets](docs/PARITY.md). Current checked results include 454 passing tests and 8 browser flows, including a decoded 1080p MP4 export. They do not establish Higgsfield generation quality or performance parity.

## Extend it

Install a versioned JSON recipe to add a workflow and its typed form without modifying the studio. UI and MCP discover the same recipes. [Extension guide](docs/EXTENDING.md) covers recipe authoring, output bindings, adapter contracts and current limits. Specialized recipes and general creative projects share the same core.
