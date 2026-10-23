# Dependency patches

A dependency is patched only when its behavior breaks a product invariant, the fix is small, and the upstream fix is unavailable at an acceptable cost. Each patch lives in `apps/studio/patches/`, is applied by pnpm from `patchedDependencies`, keeps the dependency version exact, and is listed with its license obligations in `apps/studio/third_party/README.md`.

## Mediabunny 1.25.3 color tags

Invariant: browser export and server render produce the same colors for the same SDR H.264 source.

The pinned version ignores color tags stored only in the H.264 sequence parameter set and leaves untagged video to Chromium's BT.709 default, while FFmpeg defaults to BT.601. The patch reads the sequence parameter set tags, prefers container `colr` values, and gives untagged H.264 limited-range BT.601 with a complete WebCodecs color configuration. Other codecs keep upstream behavior.

Mediabunny 1.62.0 was evaluated instead. It adds about 59 KB of gzip JavaScript and still decodes untagged video as BT.709, so it does not satisfy the invariant by itself.

Remove the patch when an upgraded Mediabunny reads these tags and the color policy can be applied without modifying the library. `tests/e2e/video-color.spec.ts` is the acceptance check for the removal or for any upgrade.
