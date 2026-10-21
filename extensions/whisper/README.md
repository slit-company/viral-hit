# Optional local speech recognition

This independently installed extension runs [whisper.cpp](https://github.com/ggml-org/whisper.cpp) against a selected project video or audio range. It emits the shared [transcript contract](../../docs/TRANSCRIPTS.md), relative caption clips and source media intervals. Two portable recipes prepare a captioned video or an audio recording with an explicitly selected cover image. Both remain editable in the ordinary timeline.

The studio does not depend on Whisper, download models or start a speech service by default. Installing this adapter does not install its tools. The bridge is original Viral Hit code; the separately installed engine/model keep their own upstream distribution terms.

## Build and configure

Use Node 24 or newer. From this directory:

```sh
npm ci
npm test
npm run build
```

`dist/whisper.runtime.json` contains the reviewed executable adapter; `dist/whisper.pack.json` contains its two data-only recipes. Import the runtime through **Extensions → Manage runtime packages**, and the recipes through **Packs**. Alternatively use `dist/adapters` as the operator adapter directory and import the recipe pack. Do not put pack/recipe JSON files in an adapter directory.

Install a compatible whisper.cpp CLI and model separately. The bridge has been exercised with whisper.cpp 1.9.5 and the multilingual `ggml-tiny.bin` model. See the [upstream models](https://huggingface.co/ggerganov/whisper.cpp/tree/main) and [CLI](https://github.com/ggml-org/whisper.cpp/tree/v1.9.5/examples/cli). Choose a model for the actual language/accuracy requirement; a tiny-model smoke test is not a production-quality recommendation.

Configure the same values for the app, MCP and worker, then restart all three together:

```sh
export VIRAL_HIT_WHISPER_CLI=/absolute/path/to/whisper-cli
export VIRAL_HIT_WHISPER_MODEL=/absolute/path/to/ggml-model.bin
export VIRAL_HIT_WHISPER_CLI_SHA256=EXACT_LOWERCASE_SHA256_OF_CLI
export VIRAL_HIT_WHISPER_MODEL_SHA256=EXACT_LOWERCASE_SHA256_OF_MODEL
export VIRAL_HIT_FFMPEG=/absolute/path/to/ffmpeg
export VIRAL_HIT_FFPROBE=/absolute/path/to/ffprobe
```

Obtain each digest from the actual file with `shasum -a 256 /absolute/file` (macOS) or `sha256sum /absolute/file` (Linux). Keep model/tool installations immutable for pending jobs. The adapter verifies CLI/model hashes before recognition and again before accepting its output. Declared configuration participates in the existing job fingerprint. Dynamic libraries, CPU backends and FFmpeg bytes are not completely fingerprinted by this bridge.

## Use and extend

Import source media into a project, select **Runs → Caption a video** or **Caption a recording with a cover image**, choose the range and language, then queue. `auto` asks the model to detect language; explicit `en`, `ko`, `ja`, etc. must be supported by the chosen model. English-only models require English. The maximum-audio-seconds input selects up to that duration from the start point, ending at the available source audio if shorter. GPU execution is disabled; CPU threads are selectable from one to four, default two.

Review the original recording and returned words/timing, download SRT if useful, then **Add editable sequence**. SRT times are relative to the selected source range. Existing timeline content is retained and the sequence appends after it. Correct caption text and timing in the editor. The original recognition receipt remains unchanged by those edits. An empty recognition result leaves the caption track empty; it does not prove that the source contains no speech.

Recipes are portable JSON in `recipes/`. Fork them for interviews, tutorials, voice notes, narration or any other use. They expose ordinary asset/number/string parameters, use `ext.whisper-transcribe` and bind its clip output to `editor.sequence`. Recognition itself works with either source kind. An audio-only recipe can retain the transcript without creating a sequence; the supplied audio-caption recipe asks for a cover because the current video exporter requires a visual track. Other installed engines can emit the same transcript JSON without modifying the studio.

## Bounds and recovery

Each selected original is at most 64 MiB and one hour; a run decodes at most 120 seconds into mono 16 kHz 16-bit WAV, bounded to 4 MiB. Models are at most 2 GiB; this is a file limit, not a memory limit. The transcription process has a 180-second deadline inside a four-minute adapter budget. Captured tool output is at most 1 MiB, transcript JSON at most 512 KiB, and accepted segment count at most 120. Oversized transcripts fail; they are not silently truncated. Native tools can consume additional memory and CPU, especially with larger models.

Submission retains a stable request identity. Polling performs local recognition; an interruption before the successful result is stored may repeat that local computation. Completed results are retained by the harness. Cancellation/timeout sends SIGTERM, escalates after five seconds and waits for child closure before deleting private files. Missing audio is a failure, not a synthetic transcript. Crash-orphan file cleanup remains separate work.

Whisper timestamps and text are estimates. Timing outside the selected range or overlapping a prior segment is clipped and counted; empty/fully out-of-range segments are omitted and counted. This normalization is not forced alignment. Noise, silence, music, accents and mixed languages may produce missing or invented words. No speaker diarization, translation, word-level alignment or narrative understanding is implemented here.

`npm test` covers the extension's input, output, runtime-integrity and process behavior without downloading a model. Studio integration/browser tests use an explicitly labeled protocol recognizer and real media operations. Actual model executions are separate evidence in the repository's validation ledger; they do not turn protocol fixtures into quality benchmarks.
