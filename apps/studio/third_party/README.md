# Third-party notices

Viral Hit remains Apache-2.0. The local Edit workspace intentionally reuses
small, well-defined open-source layers instead of bundling another product's
application shell.

## OpenReel

- Repository: <https://github.com/Augani/openreel-video>
- Pinned commit: `5f3c85e5fc223c86060bf4b12e1b4dec58e9b8a9`
- License: MIT
- Use: timeline terminology, document shape, and non-destructive editing behavior
- Not bundled: Agent/chat, cloud accounts, provider integrations, desktop shell,
  project manager, image editor, or OpenReel UI/branding

The preserved license is in [`openreel/LICENSE`](./openreel/LICENSE), and the
machine-readable pin is in
[`openreel/PINNED_VERSION.json`](./openreel/PINNED_VERSION.json).

## Mediabunny

- Repository: <https://github.com/Vanilagy/mediabunny>
- Package version: `1.25.3` (exactly pinned in `package.json`)
- License: Mozilla Public License 2.0
- Use: browser-side media inspection, precise range conversion, WebCodecs
  encoding, and MP4 muxing

The preserved license is in [`mediabunny/LICENSE`](./mediabunny/LICENSE).
Mediabunny is consumed from npm with one local modification,
[`patches/mediabunny@1.25.3.patch`](../patches/mediabunny@1.25.3.patch),
applied by pnpm at install time. It reads H.264 color tags from the sequence
parameter set when an MP4 has no `colr` box, and gives untagged H.264 the same
limited-range BT.601 interpretation FFmpeg uses. The patch modifies
`codec-data` and `isobmff-demuxer` in both `src/` and `dist/`; those
modified files remain available under MPL-2.0 through the patch file. Viral Hit does not
bundle a native FFmpeg executable, and browser-native editing and MP4 export do
not require a system FFmpeg installation. Optional MCP/Node frame extraction
and Timeline rendering require user-provided `ffmpeg`; Timeline rendering also
requires `ffprobe`.
