# Procedural audio provider

An optional dependency-free implementation of the [audio provider contract](../../../docs/AUDIO-PROVIDERS.md). It generates real mono 24 kHz PCM16 WAV tones from Frequency, Length and Wave shape controls. The prompt is retained for history but is not interpreted. This is not a speech or music AI.

Install the folder under your configured providers directory and restart the studio/MCP server. `procedural-sound` returns immediately; `procedural-sound-queued` demonstrates task/status completion. The example does not run a daemon, download models or call paid services. Both use the same project asset store and can be replaced with independent general or specialized implementations.
