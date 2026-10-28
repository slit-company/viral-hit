# App and website inspection

`extensions/rea/` is an optional bridge to an operator-installed, versioned REA CLI. It owns target configuration, bounded child processes and retained private evidence. It is not part of the studio dependencies and does not register or modify the operator's coding-agent configuration.

The browser supplies a configured target ID and a research question, never a shell command, local path or browser debugging endpoint. The operator target catalog selects an extracted JavaScript/Electron application or one browser target at one exact origin. Analysis is read-only: the bridge does not launch target applications, navigate websites, run their source, submit forms or invoke discovered APIs. REA is trusted analysis software, not a sandbox; its separate process bounds execution time and output, with a V8 heap limit rather than a total RSS guarantee.

Two ordinary portable recipes call the existing external-adapter operation. The existing harness owns queueing, job identity, cancellation and status. The extension retains an exclusive per-job intent before starting, private evidence and a small summary. A restarted submission only reconciles a completed retained result; an interrupted observation is not silently rerun against changed targets. Reports record REA version, operation, source evidence IDs/hashes, observations and limitations. Observed structure and static candidates do not establish complete behavior, backend implementation or reconstruction equivalence.

The extension holds one cross-process analysis lock per configured evidence directory. No new polling queue or always-running engine is added. Raw evidence remains in that operator-selected private directory; the existing job result stores only the bounded report. `core/inspection/` owns the browser-safe report contract and `components/app/inspection-result.tsx` displays it. A companion skill explains how an agent converts evidence into a feature map and a testable reconstruction plan without treating captured text as instructions.

Native binary decompilation, automatic browser actions, video decomposition and automatic code installation are outside this bridge's initial scope. REA's own tools may support broader workflows independently.

## Browser budget decision

On the 73840b4 base, an isolated production build without the new report import/render measured 613,977 bytes of aggregate gzip JavaScript. The final report validator and SEED-based view measured 615,107 bytes, a 1,130-byte increase (about 0.18%). The prior 614,000-byte allowance had only 23 bytes available. The aggregate allowance is therefore 616,000 bytes; the 10 MB total asset limit is unchanged. This is measured report UI overhead, not an engine dependency exemption. `rea-agents` is explicitly forbidden in studio dependencies by the performance gate. Raw measurement files stay with local verification evidence.
