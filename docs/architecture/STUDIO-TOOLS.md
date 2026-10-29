# Task-first Studio

The reference is Sume's **creation interface**, inspected at https://www.sume.com/videos on 2026-10-29: a top-level operation menu, an input/model panel on the left, and history/how-to content on the right. Viral Hit uses its own SEED actions, shared controls, light design tokens and existing example assets. Sume is not a product dependency or the owner of this interface.

## Boundaries

- `core/studio/tools.ts` defines operations and compatible model selection independently of providers.
- A provider model may declare `studioTasks` in `provider.json`. The installed manifest validates task IDs and output kind; the model catalog carries them to the client. Old manifests fall back to their general media operation, without guessing specialized capabilities from a model name.
- `cloud-api-catalog.ts` declares the existing Cloud adapter's image creation/editing, video generation, motion control and analysis capabilities. Optional extensions, including Sume, use the same contract. A task can have models from multiple independent providers.
- `use-studio-tools.ts` selects task/provider/model and remembers project-specific selection in session storage. Missing models remain missing until explicitly replaced; no silent substitution of a requested unavailable model. Existing audio, analysis and source draft stores remain authoritative for input data.
- `studio-tool-navigation`, `studio-tool-composer`, `studio-inline-options` and `studio-tool-guide` own presentation. Parameters and reference limits come from the selected model's catalog; a pure text model does not display an upload invitation.
- `studio-workspace` retains precheck → single-use intent → generation → status observation → project history. The UI does not call provider APIs or receive keys directly. Credentials stay in the existing server-side configuration stores.
- `studio-result-actions` resolves the retained project asset and invokes the existing revision-checked timeline command. Image/video/audio results can be added to the editor. Analysis remains text output.

## Adding an operation to a provider

```json
{
  "id": "example-motion",
  "name": "Example Motion",
  "kind": "video",
  "studioTasks": ["motion-control"],
  "aspectRatios": ["16:9", "9:16"],
  "referenceInputs": {
    "image": { "min": 1, "max": 1 },
    "video": { "min": 1, "max": 1 },
    "audio": { "min": 0, "max": 0 }
  }
}
```

This is an excerpt of a model entry, not a complete installable provider. The module still implements the existing generation adapter contract. Different API wire formats require adapters; registering a URL alone does not implement an arbitrary API. Installed credentials are managed under Extensions, Cloud credentials through its existing settings dialog, and compatible packages through Runtime Packages.

A task with no installed compatible model shows the installation path. A known but unconfigured model shows connection requirements and disables generation. This distinguishes a visible workflow from an available model. It does not imply Sume/Higgsfield output quality, nor that every visible task already has a configured provider.

## Verification

`studio-tool-workflow.spec.ts` switches between two independent local image providers, inspects submitted model IDs and aspect ratio, reloads the selected provider, adds the retained output to a real timeline and opens the editor at desktop/mobile sizes. These fixtures create real gradient files and are explicitly **not AI-quality evidence**. Existing Studio browser tests cover mixed references, actual audio/video playback, masks, analysis settings, history reuse and unavailable model drafts. No Sume API call or paid generation is needed for these checks.

## Production budget and styling

Common vendor modules used by multiple entry points share a chunk through [Rolldown code splitting](https://rolldown.rs/reference/OutputOptions.codeSplitting). Media engines remain dynamically imported. The canonical CSS layer declaration is prepended to SEED stylesheet sources before splitting and hashing; this preserves SEED styling when a vendor stylesheet loads before global CSS. Keyboard focus indicators are retained.

The final production check measured **614,239 bytes** for the sum of gzip-compressed JavaScript chunks (existing ceiling: 616,000 bytes), and **9,030,553 bytes** for all public assets (ceiling: 10,000,000). No runtime dependency or budget increase was added. These are bundle measurements, not generation latency or AI quality measurements.

Validated on 2026-10-29: 932 unit/integration tests, 12 targeted Studio browser tests, 7 optional Sume adapter tests; architecture, types, locale checks and production build. The additional production browser run exercises provider switching, creation, result-to-timeline attachment and editor navigation at 1440×1000 and 390×844.
