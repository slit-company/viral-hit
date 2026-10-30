# Official Viral Hit Skills

This directory is the source of truth for portable creative Skills bundled with
Viral Hit. Each Skill lists its evidence below; a Skill whose Viral Hit MCP
evaluation has not run yet says so.

| Skill | What it helps an agent do | Evidence |
|---|---|---|
| [hit-remake](hit-remake/SKILL.md) | Remake a proven video shot by shot with any connected model, then cut and export it | Adapted from production remake workflows; MCP evaluation pending |
| [video-model-routing](video-model-routing/SKILL.md) | Choose a model per shot from declared inputs, length and cost; retry confirmed failures, never resubmit an uncertain paid job | Adapted from production routing rules; MCP evaluation pending |
| [batch-variations](batch-variations/SKILL.md) | Produce several variations in parallel with one shared preparation and per-item tracking | Adapted from production batch workflows; MCP evaluation pending |
| [character-intro](character-intro/SKILL.md) | Exact five-second character intro from five consistent keyframes, one plate and optional narration | Adapted from a production intro workflow; MCP evaluation pending |
| [voiced-short](voiced-short/SKILL.md) | Narration, timed captions, music and a loudness check before export | Adapted from production ad finishing; MCP evaluation pending |
| [publish-and-measure](publish-and-measure/SKILL.md) | Publish with explicit approval, record performance and write the next brief | Adapted from production publishing; MCP evaluation pending |
| [storyboard](storyboard/SKILL.md) | Plan multi-shot work from owned references, accept one take per shot and assemble an editable sequence | Browser and MCP storyboard workflows |
| [consistent-characters](consistent-characters/SKILL.md) | Define a character from images and keep/never rules, add it to projects and attach it to Canvas drafts without duplicates | Three-scenario evaluation recorded under research/evidence/skills; browser test `choosing a character in the Canvas composer…` |
| [recipe-packs](recipe-packs/SKILL.md) | Find, share and maintain general or job-specific packs; review explicitly requested executable runtimes | Four-scenario evaluation under research/evidence/skills; MCP/browser pack workflows and `runtime skill flow stages reviewed code…`; lifecycle evidence under research/evidence/runtime-packages |

Each accepted Skill lives in `skills/official/<skill-id>/` and contains exactly
the two required source files:

```text
<skill-id>/
├── skill.json
└── SKILL.md
```

`skill.json` uses schema version `1` from
`src/core/skills/skill-registry.ts`. Its `id` must match the directory name.
`SKILL.md` contains model-readable workflow instructions. A bundled Skill may
reference Viral Hit MCP tools, but it must not contain executable scripts,
credentials, generated user media, or automatic authorization for paid
generation and export.

Set `scope` to `general` when the skill helps any project and `specialized`
when it serves one format, job, audience or brand. Skills that are not bundled
live in the operator's own folder (`VIRAL_HIT_SKILLS_DIR`) and appear with
source `local`; see [docs/SKILLS.md](../../../../docs/SKILLS.md). Check any
folder with `pnpm skill check <folder>`.

The Showcase UI and host-specific installation packages are consumers of this
registry. They must not become separate Skill sources of truth.
