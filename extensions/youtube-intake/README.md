# Optional YoutubeExplode intake engine

A small command-line worker using **YoutubeExplode 6.6.2**, separately from the YoutubeDownloader desktop app. Requires .NET 10 and FFmpeg. It is not installed, restored or started by the studio automatically. No browser bundle imports it.

Build from this directory:

```sh
dotnet restore --locked-mode
dotnet build --no-restore -c Release
```

Configure the local intake CLI with absolute paths:

```sh
export VIRAL_HIT_YOUTUBE_ENGINE=/absolute/viral-hit/extensions/youtube-intake/bin/Release/net10.0/YoutubeIntake.dll
# Optional when dotnet is not on PATH:
export VIRAL_HIT_DOTNET=/absolute/dotnet
export VIRAL_HIT_FFMPEG=/absolute/ffmpeg
export VIRAL_HIT_FFPROBE=/absolute/ffprobe
```

From `apps/studio`, run `pnpm reference --project PROJECT_ID --youtube VIDEO_ID --height 720`. See [reference intake](../../docs/REFERENCE-INTAKE.md) for the shared project boundary and other sources.

The worker selects MP4 video and audio streams separately, downloads through YoutubeExplode's stream API and muxes with FFmpeg without re-encoding. It does not assume a combined stream exists. Maximum height is selectable from 144 through 1080; a lower available rendition can be selected. Aggregate download and final output are capped at 256 MiB; source duration is at most one hour. The engine deadline is 180 seconds, mux deadline 30 seconds. Downloads use a 128 KiB reusable buffer. Input is a single exact YouTube video ID, not an arbitrary URL, playlist or search request.

The worker receives a minimal environment and never prints stream URLs, response bodies or cookies. The parent waits for shutdown before removing temporary files. POSIX SIGTERM cancels requests and terminates an active mux process. Windows process-tree cancellation is not verified. Abrupt machine/process termination can leave temporary files; this is not an OS disk quota or an execution sandbox.

No login cookies, private-video support, channel discovery, timed caption intake or playlist import are exposed by this first bridge. YoutubeExplode offers additional APIs that can be added behind explicit contracts. Upstream service changes can break download support independently of a successful local build.

Primary engine documentation: [YoutubeExplode](https://github.com/Tyrrrz/YoutubeExplode). A standalone YoutubeExplode tool informed the engine-only boundary; its Korean-caption requirement and campaign rules are not carried into the general importer.
