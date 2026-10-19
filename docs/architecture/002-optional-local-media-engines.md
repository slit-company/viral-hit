# 002: Optional local media engines

Status: accepted for this implementation.

`extensions/local-media/` owns an independently installed adapter package for music2 and vid2. Neither engine is a studio dependency or browser import. Installing the studio does not install these tools; discovering an installed descriptor does not start them. The existing serial harness worker starts bounded subprocesses only for queued jobs. The package has its own exact dependency versions and lockfile.

The input is an authored music2 Song JSON or vid2 Timeline JSON, not executable source. This first bridge supports self-contained synthesized music and procedural motion graphics. It rejects external files, custom plugins, generated sources and remote providers before invoking the tools. Ordinary project-media bindings, sampled instruments and full native timeline round-tripping require explicit later contracts. Outputs are real WAV/MP4 binaries, published through the existing immutable receipt and `asset.materialize` boundary, then usable in the normal editor.

The extension owns input complexity limits, upstream validation, subprocess deadline/output bounds, cancellation of the process group, temporary workspace cleanup and runtime version checks. It does not promise an OS memory sandbox. Node/Bun/FFmpeg and installed package files are operator-managed trusted executables. The descriptor digest pins bundled bridge code; the compiled lockfile digest and package versions detect a different install manifest, not arbitrary tampering with installed package contents. Deployment must keep that runtime immutable while jobs are pending.

Recovery is replayable because work is local and has no paid/network side effects. `submit` allocates only the existing stable key. `poll` first recovers an existing binary receipt; otherwise it renders in a unique temporary directory. Aborted or failed work publishes nothing. The harness lease and atomic receipt enforce ownership. A crashed process may leave a temporary directory; startup does not delete another worker's files.

Verification includes rejection of resource references, excessive duration/complexity, cancellation of descendants, malformed/oversized child output, mismatched installed versions/lockfile, cleanup and binary receipt recovery. Live validation uses the actual installed engines, real media probing and harness materialization. Footprint measurements distinguish the unchanged browser/server build from the optional runtime's disk/memory/render cost. This does not establish Higgsfield parity or generation quality.
