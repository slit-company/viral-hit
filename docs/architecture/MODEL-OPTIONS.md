# Independent model option boundary

The installed-provider manifest owns bounded control definitions. `core/generation-providers/model-controls.ts` is pure: definitions, typed value validation, defaults and model-scoped draft projection. Optional fields without defaults preserve legacy manifest fingerprints. There is no registry separate from the existing model binding.

Discovery carries public definitions through the metadata binding and descriptor. UI uses the shared SEED controls through one feature-local form. Common media/prompt routing remains in the generation compiler; custom values are namespaced under `provider_options`, with no arbitrary top-level input merge.

Asset-first admission resolves/rejects values before uploads, stores normalized input through the existing generation ledger, and the executable adapter independently revalidates before module loading. It projects `input.options` alongside the established clean provider input. Status polling remains task-ID-only. No configuration, secret, path or arbitrary internal field is exposed through the options projection.

Canvas drafts and captured configurations use `{modelId,values}` so model switches cannot leak settings. Existing command/snapshot persistence handles those values with the same revision checks. Optional values are backward compatible; newer stored fields may require newer importing clients. Heavy model libraries remain external. Verification covers invalid admission, default normalization, module-import fencing, actual measured source output, browser authoring/persistence and the shared schema.
