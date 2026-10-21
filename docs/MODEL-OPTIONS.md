# Declared model options

An independent generation provider may declare up to 16 `controls` on each model in `provider.json`. Image, video and analysis models use the same contract. A general model can offer a seed or rendering setting; a specialized reviewer can offer an output profile or measured delivery target. The app does not need a provider-specific component or a core edit.

```json
{
  "key": "minimum_height",
  "type": "number",
  "label": "Minimum height",
  "description": "Compare measured video height with this pixel target.",
  "min": 0,
  "max": 8192,
  "integer": true,
  "default": 0
}
```

Supported controls:

- `string`: `default`, explicit `maxLength` from 1 to 4000, optional `multiline`.
- `number`: finite `default`, `min`, `max`, optional `integer` (safe integer values).
- `boolean`: boolean `default`.
- `select`: string `default` and 1–32 distinct `{value,label}` choices.

Every control has a unique lowercase `key` (letters, numbers, underscores, starting with a letter, at most 40 characters), a label and an optional description. Reserved object keys are rejected. Defaults must satisfy their control. Unknown definition fields are rejected. These are public creative settings, not credential fields. Server credentials continue to use the provider's declared environment variables. Files remain project references, not path-valued controls.

## Shared admission and execution

Model discovery returns `controls` and resolved `defaultParameters.provider_options`. The workspace model endpoint exposes the same definitions. HTTP, MCP and CLI generation requests put supplied values under `parameters.provider_options`:

```json
{
  "provider_options": {
    "report_name": "Delivery audit",
    "minimum_height": 720,
    "framing": "landscape",
    "include_hash": false
  }
}
```

Admission rejects undeclared keys, incorrect types, out-of-range numbers and unsupported choices before managed uploads or generation. Omitted fields resolve to the declared defaults. The resolved values are retained in the generation input. The installed adapter validates again before importing or calling provider code, then sends only declared values as `input.options`. Common prompt, references, aspect ratio and duration remain separate fields; custom options cannot override them.

The optional [technical inspector](../examples/providers/media-inspector/README.md) demonstrates all four types against real FFprobe measurements. Minimum height and expected framing produce measured checks; report name and checksum display affect text presentation. Turning off checksum display does not disable source hashing or ownership verification. No inference model is bundled.

## Browser authoring and persistence

Canvas offers **Model options** for installed image, video and analysis models that declare controls. Studio offers the same form for image, video and independent analysis models. Analysis history reuse restores the recorded model-scoped options and depth along with its media sources. The form edits a local copy: **Apply options** changes the draft, Escape discards unapplied edits, and **Reset defaults** fills the form without starting generation. Values are associated with the selected model ID, so changing models cannot send another model's settings.

Canvas project snapshots and generation snapshots retain the bounded option values. The generation history's stored input retains server-resolved defaults. Provider package changes still require restart. Existing pending managed tasks retain the original runtime fingerprint and cannot silently migrate to a changed manifest. Existing manifests without `controls` retain their normalized structure.

The browser discovery cache can be stale after a server/provider restart; invalid old values fail server validation rather than being coerced into a new choice. Refresh the page to reload definitions. Rich nested forms, file controls, conditional fields, automatically migrating saved settings and a generalized graph editor remain open. This change does not establish model quality or arbitrary upstream API compatibility.
