# README demo recording

The demo in `docs/readme/demo.mp4` is recorded from a running studio with real model calls. It costs a few cents on the connected accounts (one Higgsfield Soul 2 image, one xAI Grok Imagine edit, one short ElevenLabs line).

1. Start the studio (`pnpm dev` in `apps/studio`) with Higgsfield, xAI and ElevenLabs connected.
2. `VIRAL_HIT_URL=http://127.0.0.1:3000 node scripts/demo/record-create.mjs` records the home prompt, the Higgsfield image, the targeted xAI edit and the voice-over. It writes `marks.json` with the start and end of every generation wait.
3. `node scripts/demo/record-finish.mjs` continues in the same project: media bin to timeline, MP4 export, publishing, connections, canvas and the Korean interface. It saves the exported file as `export.mp4`.
4. Cut each wait in `marks.json` down to its first and last second, insert `export.mp4` after the export, and label every cut with the seconds removed. Generation waits are the only edits.
