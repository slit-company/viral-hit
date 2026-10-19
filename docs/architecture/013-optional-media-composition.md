# 013 — Optional project media in composition recipes

## Decision

External adapter descriptors may mark a declared media input `optional: true`. Absence is explicit JSON `null` at the payload pointer and a matching null pin. Missing keys, empty IDs and present-but-unpinned assets remain errors. Required inputs keep existing behavior. The optional field has no parser default, preserving the descriptor digest of existing adapters.

Present optional inputs use the same project membership, kind, size and content hash checks as required inputs. A materializer binding still carries the complete project/asset/hash/size identity; a null placeholder with a binding is not absence. `readAsset` cannot read an absent slot. This is a general harness contract, with no vid2-specific behavior in core.

`extensions/local-media` adds `ext.vid2-compose`: structured Timeline v1 plus two image, two video and two audio slots. Authored sources use `asset:<slot>` tokens; the adapter stages verified bytes in its private temporary directory and substitutes paths only in the execution copy. Captures, arbitrary paths/URLs, providers, TTS, fonts and LUT files remain outside this bridge. Ordinary procedural `ext.vid2-render` and music2 behavior are retained.

## Execution and recovery

The composition is local and replayable. It recovers a published binary before accessing originals, validates input containers and bounded FFprobe metadata, renders one segment at a time and publishes a durable MP4 receipt. Six declared slots total at most 256 MiB; output is at most 64 MiB. The descriptor allows 180 seconds with cancellation propagated to the existing POSIX process-group terminator. Native processes are trusted, not an OS sandbox. Installed engine/runtime versions and lock digest remain pinned.

The authored timeline stays in the durable input. Output is a flattened video asset that can be trimmed, split, replaced as a take or mixed in the editor. Layer-by-layer vid2 round-trip and arbitrary streaming sources are separate work.

## Evidence

Tests cover explicit absence, required-field compatibility, foreign/tampered originals, unsafe resource references and original receipt recovery. The real engine verifier composes music2 output and a rendered image motion using materializer-to-optional-slot bindings, checks both video sizes/frame counts, detects a synthetic narration tone in the mix, verifies original hashes and exports the resulting editor timeline. Frame review checks both portrait and landscape outputs; it is not a model-generation or advertising-performance benchmark.
