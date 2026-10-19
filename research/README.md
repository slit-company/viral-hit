# Competitive research — 2026-10-19

Research conducted through Aside Browser: the requested Comfy announcement and Threads post, live Higgsfield interfaces, Google discovery scoped to Instagram/X/Threads, direct social posts, GitHub metadata and pinned local source inspection. This is a broad initial census, not a claim that every existing repository was found or executed.

## Competition facts

[Official competition](https://comfy.org/open-source-higgsfield), [announcement](https://blog.comfy.org/p/higgsfield-promised-to-open-source), [requested Threads post](https://www.threads.com/@choi.openai/post/Deje6i8j66l).

- Build using Comfy Developer Platform: Comfy Router and/or Comfy SDK.
- Public GitHub source, workflow files, open-source license, locally reproducible setup.
- Demo video at most two minutes; a hosted demo is encouraged.
- A social demo post tagged `#OpenSourceHiggsfield` is required. No post or submission has been sent.
- One entry per person; SFW and no unlicensed IP or likenesses.
- Deadline: 2026-10-30 09:00 Pacific = **2026-10-31 01:00 Asia/Seoul**. Winners announced November 6.
- Best Overall $10,000; Most Innovative, Most Viral, Open Weights Only each RTX 5090; additional ecosystem bonuses. Winning is not guaranteed by satisfying the requirements.

## Social discovery, checked against source

| Source | Discovery | Verification |
|---|---|---|
| [Instagram / 100xengineers](https://www.instagram.com/reel/DXUH5dcDwKN/) | “Open-source Higgsfield” | Post directly read; model-count/free claims are marketing, not tested cost or quality |
| [X / Diffusion Studio author](https://x.com/konstipaulus/status/2104597254585643425) | Editor MCP, multitrack, captions, keyframes, GPU export | Post and replies directly read; editor/core source cloned; MPL-2.0 checked |
| [Threads / ReelMimic](https://www.threads.com/@neo_osiki/post/DeDg6s_isH5) | Reference analysis, planning, independent review, timed feedback | Full four-part thread read; MIT repository cloned; social feature claims still require runtime tests |
| [Threads / OpenCut](https://www.threads.com/@billionnapkin/post/DWuiHi1k946/) | CapCut alternative | Search discovery; upstream README shows current rewrite versus archived classic |
| [Threads / video-use](https://www.threads.com/@h2smusic/post/DcyYA4FE26Y/) | Agent-led editing | Search discovery; source and README inspected |
| [Instagram / Palmier](https://www.instagram.com/p/DZxFPZjjnTN/) | AI-native editor | Search discovery; upstream now says only historical source is GPL, later binaries proprietary |
| [X / Pireel](https://x.com/the_osps/status/2096556017463251237) | Browser AI editor | Search discovery; AGPL editor and separate Apache agent plugin verified |

## Initial candidate groups

Exact URLs, commits, clone status and observed license metadata are in `upstream-lock.json`. Root license files take precedence over GitHub metadata or promotional descriptions.

| Candidate | Role | Evidence / caveat |
|---|---|---|
| Anil-matcha/Open-Generative-AI | Broad model catalog and generation studios | MIT; 600+ models is upstream claim, not 600 verified integrations |
| Autom8AI/Open-Higgsfield-AI | Earlier fork of the same family | README claims MIT but root license missing in inspected checkout; do not copy into product |
| diffusionstudio/editor | Agent-driven full editor | MPL-2.0; recent desktop focus; evaluate as alternative editing engine |
| diffusionstudio/core | Browser compositing | MPL-2.0; WebCodecs; separate older engine repository |
| diffusionstudio/agent | Editing agent framework | MIT; older than current editor; not evidence of current editor architecture |
| OpenCut-app/OpenCut | Rust/plugin/headless editor rewrite | MIT; README explicitly says rewrite underway |
| OpenCut-app/opencut-classic | Existing browser editor | MIT; archived; main README recommends this version for current use |
| pireel/pireel | Canvas/timeline/chat/MCP | AGPL-3.0; evaluate separately before mixing implementation |
| pireel/pireel-agent | Agent connector | Apache-2.0; connector does not make the editor Apache licensed |
| browser-use/video-use | Reference editing and render QA | MIT; agent skill/tool pipeline, not full standalone studio |
| edenfunf/reelmimic | Reference style → production/review | MIT; promising edit feedback and review contracts |
| palmier-io/palmier-pro | Native macOS NLE | Historic source GPLv3 through v0.7.6 / last-gpl-source; newer releases proprietary |
| Comfy-Org/comfy-cinematic-studio | Official Router integration example | MIT; cinematic image generation only, not a complete video editor |
| HBAI-Ltd/Toonflow-app | Agents, canvas, storyboards, assets | MIT in current monorepo; not limited to old split web repository |
| HBAI-Ltd/Toonflow-web | Historical web frontend | Archived; Apache root license but stale AGPL badge; use current monorepo instead |
| WeftCut/WeftCut | Desktop NLE operated through MCP | MIT; pre-1.0 development |
| poseljacob/agentic-video-editor | Planning, cut refinement, render/review | MIT; CLI supported, web UI explicitly work in progress |
| ncounterspecialist/twick | Video editing SDK | Actual Sustainable Use License restricts standalone resale/rebrand/hosted products; exclude from reusable product source |
| itsjwill/vanta | AI video workspace | Root MIT plus third-party/model conditions; integrations not fully license-audited |
| heygen-com/hyperframes | HTML-based video composition | Apache-2.0; candidate for motion graphics, separate from model generation |
| Comfy-Org/comfy-typescript-sdk | Router and Cloud provider client | MIT; actual pinned SDK now used by Viral Hit; Router and Cloud retry semantics differ |
| Comfy-Org/comfy-python-sdk | Python provider client | MIT; potential Python worker adapter |
| Comfy-Org/comfy-api-proxy | Self-hosted endpoint bridge | MIT; requires a running backend; not bundled weights or free compute |
| Comfy-Org/ComfyUI | Open-weight workflow execution | GPL-3.0; keep its service boundary and license obligations explicit |

The public repositories above are cloned at pinned commits. Cloning a reference is not evidence of a successful runtime test or permission to redistribute it.

## Current conclusion

Generation UI breadth is already common. Canvas + timeline + MCP is also already available. Viral Hit must earn its differentiation through reliable revision handling, selective recomputation, output quality, recoverable execution, and a continuous creation-to-editing experience. Compare those dimensions; do not infer superiority from stars or feature counts.
