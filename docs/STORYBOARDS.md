# Storyboards and shot acceptance

Storyboards connect a creative plan to existing recipes, project assets, durable runs and the editor. Use the same structure for a general film, a character introduction, a product demonstration or another specialized job. There is no fixed narrator, channel, aspect ratio, brand, model or narrative formula.

The current surface is the `viral_hit_storyboard` MCP tool, `pnpm storyboard <projectId> < request.json` from `apps/studio`, and trusted local POST `/api/app/projects/<projectId>/storyboards`. GET lists boards. Browser storyboard authoring is not yet implemented; assembled work appears in the existing Runs panel and editor. The bundled **Storyboard director** skill describes the whole workflow.

## Plan

Read project assets and the recipe catalog first. A save with expectedRevision 0 creates a board; later saves compare the exact current revision and retain earlier versions.

```json
{
  "action": "save",
  "id": "color-study",
  "expectedRevision": 0,
  "plan": {
    "schemaVersion": 1,
    "title": "A quiet color study",
    "scope": "general",
    "intent": "An original two-beat composition with deliberate color contrast.",
    "references": [],
    "shots": [
      { "id": "opening", "title": "Opening field", "duration": 2, "direction": "Hold a warm field.", "preserve": ["A still camera"], "change": [], "avoid": ["Unrequested objects"], "caption": "" },
      { "id": "closing", "title": "Cool contrast", "duration": 3, "direction": "Cut to a cool field.", "preserve": ["A still camera"], "change": ["Color"], "avoid": ["Unrequested objects"], "caption": "" }
    ],
    "audio": []
  }
}
```

For reference-led work, add observations with `id`, project-owned `assetId`, `sha256`, `observation` and `basis` (`observed`, `inferred` or `proposed`). Video/audio observations may specify startTime/endTime. Shots refer to observation IDs in `references`. The server verifies owned bytes and ranges; it does not certify the observation. Five sampled reference frames do not establish whole-video inspection.

Each shot may specify `recipe: { id, digest, values, outputNodeId }`. Use the digest returned by the recipe catalog and name an image/video materialization node. `values` are the actual executable inputs. Direction/preserve/change/avoid are review context, not silently injected prompts. The author or planning agent must map the desired direction into the selected recipe's declared parameters.

## Generate and review

- `{ "action": "read", "id": "color-study" }` returns current state and action/job status. Add `revision` to read a retained version.
- `generate` takes `id`, `expectedRevision`, `shotId` and a UUID `requestId`. It may spend provider credits through the configured recipe. The service reserves the exact pinned plan before enqueue. Use a new requestId only for an intentional new attempt.
- `{ "action": "resume", "id": "color-study", "requestId": "the-original-uuid" }` resumes that exact reservation after an interrupted response. It does not rebuild against changed recipes. A changed source/configuration can require existing harness recovery; resume is not permission for a second paid submission.
- `accept` takes `id`, `expectedRevision`, `shotId`, `notes` and either `source: { kind: "generation", requestId }` or `source: { kind: "asset", assetId, sha256 }`. Optional inPoint defaults to zero. Inspect the real output first and record honest notes. Videos must cover the shot's selected range.

Acceptance binds the shot definition, intent and referenced observations. Editing an unrelated shot preserves existing acceptance. Editing a shot or its source context clears its acceptance. Generating an alternative never replaces a previously accepted result. Historical revisions retain the original decisions and media identities. Notes remain caller-supplied review evidence, not an automatic quality score.

Optional audio entries explicitly identify an owned audio asset/hash, startTime, duration, inPoint, role and volume. A shot caption becomes an editable caption clip spanning that shot; it is not a transcription or word-alignment result.

## Assemble and edit

`assemble` takes the board `id`, `expectedRevision` and a stable UUID `requestId`. Every current shot must have accepted media. It queues an ordinary `editor.sequence` job from those exact sources and timing. The existing worker checks real media before the run succeeds.

Use the existing Runs → Add to timeline action or `viral_hit_runs_change` attach operation with the current timeline revision. Attachment appends an editable sequence and preserves existing content. A revision conflict requires reviewing the current timeline; do not blindly replace it. Replaying an accepted sequence does not duplicate it. Export and review through the existing editor. Publication remains a separate approved destination operation.

## Boundaries

There are at most 16 shots, 32 reference observations, eight optional soundtrack entries, one hour of sequence duration and 16 distinct media assets per assembled sequence. Each stored document/action is bounded to 256 KB; each project retains up to 64 board identities, 512 revisions and 256 actions. References are local files up to 256 MiB each and 512 MiB total; existing recipe/sequence media limits may be stricter. No model download, extra daemon or background polling is introduced.

Plans are project-local. Saving/exporting JSON does not transfer assets, boards are not yet included in project bundles, and retained history has no automatic purge. Automated visual/semantic analysis, model-quality comparisons, planning UI and full reference-remake fidelity remain separate work. The implementation draws on reference pipeline's separation of planning, attempts and review, and the installed reference-production skill's explicit observation and preserve/change decisions; no private operational data or brand-specific request schema was imported.
