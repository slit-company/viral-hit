# Skills

A skill is know-how an AI agent follows while it works in Viral Hit through MCP: when to use a feature, which tools to call in which order, what to show the user and where to stop. Skills are plain files, so anyone can write one for any project or for one very specific job.

| | General | Specialized |
|---|---|---|
| Fits | Any project | One format, job, audience or brand |
| Bundled examples | `recipe-packs`, `consistent-characters` | `product-ad-shots` in `examples/skills` |
| Label in skill.json | `"scope": "general"` | `"scope": "specialized"` |

Viral Hit lists two sources. **Official** skills ship in `apps/studio/skills/official` and were evaluated with real MCP workflows. **Local** skills come from a folder you choose, so you can keep your own or your team's skills in any repository without changing the app.

## Install skills

1. Put each skill in its own folder inside one skills folder, for example `~/my-skills/shop-reels/`.
2. Set `VIRAL_HIT_SKILLS_DIR=/absolute/path/to/my-skills` in `apps/studio/.env` and restart the studio and MCP server.
3. Run `pnpm --dir apps/studio skill list`. Agents see the same list through `viral_hit_skill_list` and read a skill with `viral_hit_skill_get`.

A local skill that cannot be loaded is listed under `problems` with the reason; the other skills keep working. A local skill cannot replace an official one with the same id.

## Write a skill

A skill folder holds exactly two files, and the folder name must equal the skill id:

```text
shop-reels/
├── skill.json
└── SKILL.md
```

`skill.json` follows schema version 1: `id` (lowercase words joined by hyphens), `version`, `title`, `summary`, `scope`, optional `author` and `license`, the minimum Viral Hit version and the MCP tools it needs, inputs, and stages with `reviewRequired` where the user must approve before the agent continues. Start from [product-ad-shots](../examples/skills/product-ad-shots/skill.json). Editors can check it against [skill.schema.json](schemas/skill.schema.json).

`SKILL.md` is written for the agent. Say when to use the skill, give numbered steps with the exact tool calls, say what to show the user before changing anything, and list the boundaries. A specialized skill can build on general ones; `product-ad-shots` asks the agent to read `consistent-characters` and `recipe-packs` instead of repeating them.

Check a folder before you share or install it:

```sh
pnpm --dir apps/studio skill check /absolute/path/to/shop-reels
```

It validates both files and reports whether this installation has the Viral Hit version and MCP tools the skill needs.

## Rules for every skill

- No executable scripts, credentials, private account details or generated user media.
- A skill never grants permission for paid generation, export or publishing; the agent asks the user for each run.
- Keep brand rules and campaign data in your own skills folder or repository. To propose a skill for the official folder, open a pull request with an evaluation that follows only the SKILL.md through real MCP requests, as described in [official skill rules](../apps/studio/skills/official/README.md).
