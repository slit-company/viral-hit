# Skills

A skill is know-how an AI agent follows while it works in Viral Hit through MCP: when to use a feature, which tools to call in which order, what to show the user and where to stop. Skills are plain files, so anyone can write one for any project or for one very specific job.

| | General | Specialized |
|---|---|---|
| Fits | Any project | One format, job, audience or brand |
| Bundled examples | `recipe-packs`, `consistent-characters` | `product-ad-shots` in `examples/skills` |
| Label in skill.json | `"scope": "general"` | `"scope": "specialized"` |

Viral Hit lists three sources. **Official** skills ship in `apps/studio/skills/official` and were evaluated with real MCP workflows. **Local** skills come from a folder you choose, so you can keep your own or your team's skills in any repository without changing the app. **Installed** skills are files you add through the studio, MCP or CLI and are stored in the local data directory.

## Install a shared skill

Open **Skills** in the navigation. Import a `.viralhit-skill.json` file or paste its HTTPS link (GitHub file links work too). The review shows its scope, author, inputs, workflow stages, complete instructions, required tools and compatibility. **Install skill** adds it immediately to UI and connected agents, without restarting either process. Nothing runs on installation.

General and specific-job filters apply equally to official, operator-folder and installed skills. An incompatible skill or an ID held by an official/operator skill cannot be installed. Reinstalling the identical file is a no-op. Importing a different revision with the same installed ID opens an update review. Installation and replacement are atomic: an interrupted write cannot expose half a skill. Skills are instructions from their authors, not authorization to run jobs or override the user.

Use **Read skill → Download skill** to share any skill. The file contains its full manifest and instructions. It has no executable payload or account configuration. The editor schema is [skill-file.schema.json](schemas/skill-file.schema.json). Links use HTTPS, bounded downloads and public-network addresses with redirect checks.

## Update or remove an installed skill

Import a new file or link with the same ID. **Review update** shows the installed and incoming versions, both complete instruction texts and manifests, and compatibility problems. Download the installed version for a portable backup. Confirm the comparison, then choose **Update skill**. Changes to scope, workflow and instructions use the same path; version numbers are labels, so an explicitly reviewed same-version correction or rollback is allowed. A changed installed revision invalidates the review rather than overwriting another client's edit.

Open an installed skill with **Read skill → Remove skill…**. Review its ID/version and instructions, optionally download that exact reviewed file, confirm removal and choose **Remove skill**. Official skills and the operator folder are managed at their source and cannot be changed here. Projects, generated assets, historical jobs and saved pack snapshots are preserved. Exported packs keep their original skill definitions; reimport can restore a removed skill, while a conflicting newer definition requires separate review.

Changes appear on the next UI/MCP/CLI catalog or skill read. Removal cannot erase instructions an agent already has in its conversation. There is no automatic update polling, remote installation or background execution.

## Load skills from an operator folder

1. Put each skill in its own folder inside one skills folder, for example `~/my-skills/shop-reels/`.
2. Set `VIRAL_HIT_SKILLS_DIR=/absolute/path/to/my-skills` in `apps/studio/.env` (restart once after changing the environment setting). Folder edits appear on the next catalog read.
3. Run `pnpm --dir apps/studio skill list`. Agents see the same list through `viral_hit_skill_list` and read a skill with `viral_hit_skill_get`.

A local or installed skill that cannot be loaded is listed under `problems` with the reason; the other skills keep working. A local skill cannot replace an official one with the same id.

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

## Share and automate

From `apps/studio`:

```sh
# Make a portable file from the two-file authoring folder.
pnpm skill pack ../../examples/skills/product-ad-shots /tmp/product-ad-shots.viralhit-skill.json
# Inspect, then install the exact reviewed file using the returned digest.
pnpm skill inspect /tmp/product-ad-shots.viralhit-skill.json
pnpm skill install /tmp/product-ad-shots.viralhit-skill.json <digest>
# Replace only the reviewed installed revision; inspect returns update.digest.
pnpm skill update /tmp/product-ad-shots.viralhit-skill.json <incoming-digest> <installed-digest>
# Review the exact installed revision before removal.
pnpm skill review-remove product-ad-shots
pnpm skill remove product-ad-shots <digest>
# Export an existing skill without overwriting another file.
pnpm skill export product-ad-shots /tmp/shared.viralhit-skill.json
```

MCP `viral_hit_skill_library` has `inspect`, `fetch`, `install`, `update`, `review-remove`, `remove`, `export`, `list` and `get` actions. `inspect`/`fetch` return a digest; send it as `expectedDigest` with `install`. `update` requires incoming `expectedDigest` plus `expectedInstalledDigest` from `inspection.update.digest`. `review-remove` returns the file and digest; `remove` uses `skillId` and that `expectedDigest`. Retried replacement/removal converges without repeating a mutation. Existing `viral_hit_skill_list`, `viral_hit_skill_get` and skill resources see the same live catalog. HTTP `/api/app/skills` and CLI call that same application service. Installation neither queues generation nor changes projects.

Managed skill definitions live in `<data root>/skill-library.sqlite`, capped at 500 managed IDs and 32 MiB of active definition text. Removed IDs retain a small tombstone; no duplicate version archive is stored. Existing `<data root>/installed-skills/<id>/` folders remain readable and unchanged; the first lifecycle mutation creates a managed override. Back up the data root or export portable files. See [storage and recovery](architecture/SKILL-LIFECYCLE.md). Community discovery and managed executable-extension lifecycle remain separate work.
