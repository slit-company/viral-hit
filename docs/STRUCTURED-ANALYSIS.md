# Structured analysis into editable storyboards

Independent analysis providers may return a versioned report alongside (or instead of) plain text. The same contract works for general reference analysis and a specialized technical or creative reviewer. The studio validates structure and source identity; it does not verify the model's interpretation or automatically accept its proposals.

## Provider output

Return `status: "succeeded"` and `report`. The public [JSON schema](schemas/analysis-report.schema.json) describes author input; regenerate it with `pnpm provider report-schema <new-output.json>` from `apps/studio`. Runtime validation additionally enforces unique observation IDs, positive intervals and the UTF-8 byte limit.

```js
return {
  status: "succeeded",
  report: {
    schemaVersion: 1,
    summary: "Explain what was inspected and the limits of this interpretation.",
    observations: [{
      id: "opening",
      start: 0,
      end: 2,
      description: "Your model's observation of this exact source interval.",
      proposal: {
        title: "Opening shot",
        direction: "Your proposed creative direction, for human review.",
        duration: 3,
        preserve: ["A property to preserve"],
        change: ["A property to change"],
        avoid: [],
        caption: "Optional proposed caption"
      }
    }]
  }
};
```

Observation timestamps use the editor’s millisecond timebase; convert measured durations with `Math.round(seconds * 1000) / 1000`. The observation is about original source time; proposal duration is the proposed output duration and may differ. `proposal` is optional. Without it, the draft uses the interval duration, an instruction to review/write the shot, and empty decision/caption fields. Omitted decision arrays and captions default to empty. There are no recipe IDs, executable actions or asset substitutions in a report.

Reports allow 1–64 distinct observations, times within one hour in millisecond precision (multiples of 0.001 seconds), at least 0.01 seconds per interval, and at most 256 KB UTF-8. Descriptions, directions and summary are bounded to 4,000 characters. Each decision list has at most 20 entries. Text-only analysis remains supported; when `text` is absent, the report summary becomes the displayed analysis text. Image/video generation models cannot return analysis reports. A queued provider returns a task ID as before; only its succeeded completion may include a report.

## Prepare and review

For the storyboard handoff, the analysis must have consumed one pinned local video through `referenceDelivery: "project-media"`. Text-only and remote-URL-only analyses remain in generation history but are not eligible. This prevents matching an unpinned public URL to a potentially different file. Localizing a file after an old URL analysis does not retroactively establish that original identity.

In **Storyboards → Start from a model report**, select a completed report, inspect the available intervals, select up to 16 consecutive observations, choose general/specialized scope and write your intent. **Prepare analysis draft** returns an unsaved plan. Review its reference playback, machine observations, directions and captions. Save, choose recipes, generate, accept inspected results and assemble through the normal storyboard workflow.

The shared `viral_hit_storyboard` MCP tool, project storyboards HTTP endpoint and storyboard CLI accept:

- `{ "action": "analysis-sources" }`: reports found among the latest 100 completed project generations; `hasOlder` explicitly reports a truncated candidate history.
- `{ "action": "prepare-analysis", "analysis": { "generationId": "…", "outputSha256": "…" }, "observationIds": ["opening"], "title": "My sequence", "intent": "My creative intent", "scope": "general" }`: prepare in exactly the selected observation-ID order. The API can select nonconsecutive intervals; older known generation IDs remain addressable.

The fingerprint includes validated report content, pinned source identity and provider/model identity. Preparation rechecks the generation's project/status/fingerprint, actual original bytes and measured duration. Missing, changed, foreign or out-of-range sources fail instead of clipping ranges or creating placeholders. Oversized selected content is rejected before creating an unsavable draft. No accepted result, recipe execution, publishing action or timeline mutation follows from preparation.

References retain `provider-analysis` evidence and the original generation ID/fingerprint. Portable project files retain that provenance while remapping asset IDs; it is historical evidence, not authority to execute a generation on the receiving installation. Importers must support the new evidence kind. The original full generation record is not embedded into the project file.

## Example and limits

The independent [technical inspector](../examples/providers/media-inspector/README.md) emits one structured observation of measured file metadata over the full video. It deliberately supplies no creative proposal because it does not understand scenes. Actual FFprobe output → draft preparation → explicit save is verified with original media. Provider proposal-field and queued-result tests use authored protocol fixtures; they do not establish semantic AI quality.

Multi-source/image/audio analysis, nested/conditional provider-specific forms, representative semantic-quality evaluation, automatic creative acceptance and a general graph editor remain separate work. The report bridge adds no model dependency, resident inference service or new queue.

Providers may declare bounded scalar [model options](MODEL-OPTIONS.md) for their particular analysis workflow.
