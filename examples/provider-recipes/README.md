# Independently composed model recipes

These optional JSON recipes use the same installed-provider contract as Studio. Install `procedural-images` for `image.json`; install `procedural-images`, `procedural-audio` and `audio-conform` for `calibration-card.json`. Audio conform also needs FFmpeg/FFprobe. Import through Runs → Recipe library, then queue the recipe in a project. Installation alone does not run a model.

`image.json` is a general image workflow with an editable model ID. `calibration-card.json` is a specialized four-step example: image, tone, referenced gain processing, editable image/audio sequence. The output is real local media; these examples do not perform semantic AI generation.

Fork either JSON file, choose installed models and compatible parameters, and bind retained media or analysis text between steps. No core code change is required. See [the model recipe contract](../../docs/MODEL-RECIPES.md) for runtime pins, recovery, supported bindings, output selection and limits.

`measured-calibration.json` adds an independently composed analysis → audio → editable-sequence example. Install `media-inspector`, `procedural-audio` and FFmpeg/FFprobe. Choose a project video lasting 0.1–10 seconds; its measured duration drives the model's seconds control and both track durations. The frequency stays an editable recipe parameter. Longer sources fail the downstream tone's declared bounds before generation. This is technical tone synthesis, not AI music.
