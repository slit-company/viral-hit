# Official Viral Hit Skills

This directory is the source of truth for portable creative Skills bundled with
Viral Hit. A Skill is added only after prompt evaluation and a visible Viral Hit
MCP workflow test.

| Skill | What it helps an agent do | Evidence |
|---|---|---|
| [consistent-characters](consistent-characters/SKILL.md) | Define a character from images and keep/never rules, add it to projects and attach it to Canvas drafts without duplicates | Three-scenario evaluation recorded under research/evidence/skills; browser test `choosing a character in the Canvas composer…` |
| [recipe-packs](recipe-packs/SKILL.md) | Find, review, install, build and share general or job-specific recipe packs | Four-scenario evaluation recorded under research/evidence/skills; browser test `the recipe-packs skill workflow through MCP…` |

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
