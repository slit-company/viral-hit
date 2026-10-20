# Characters

A character keeps a person, mascot or product looking the same across shots. It is a set of reference images plus written rules: what must always stay the same and what must never change. Create one under **Characters**, then add it to any project from that project's **Assets** view.

Adding a character copies its reference images into the project once, as reference assets, and shows a brief to put in prompts, for example:

> Mina Fox (mascot): Orange fox mascot with a calm smile. Keep exactly: white chest patch; round glasses; lime scarf. Never: extra fingers.

Attach the main image when you generate and include the brief. Adding the same character again reuses the copies that are already there. Archiving a character hides it from the library; projects keep the images they already have.

## What a character holds

| Field | Purpose |
|---|---|
| Name, type, description | Who or what it is: person, illustrated, mascot, product or other |
| Reference images | Up to 20 PNG, JPEG or WebP images of up to 20 MB each. One is the **main image**; others are labeled other angle, expression, outfit or detail |
| Always keep / Never change | Up to 24 short rules each, written into the brief |
| Voice direction | Optional note for narration or TTS |
| Provider identities | Optional IDs from a provider, such as a Higgsfield Soul ID, so an extension can use the provider's own identity model |

The first image becomes the main image unless you choose another. Every change raises the version, and each change must name the version it was based on, so two tabs or agents cannot silently overwrite each other. Images are checked with FFprobe before they are stored.

## Agents and scripts

UI, HTTP, MCP and CLI use the same service.

| Surface | How |
|---|---|
| UI | `/characters`, and **Assets → Characters** in a project |
| HTTP | `GET /api/app/characters`; `POST /api/app/characters` with a JSON request, or multipart `request`, `roles` and `file` fields for uploads |
| MCP | `viral_hit_character` with actions `list`, `get`, `create`, `update`, `add_references`, `remove_reference`, `set_canonical`, `archive`, `use` |
| CLI | `pnpm character list`, `get <id>`, `use <id> <project-id>`, `request <request.json>` |

MCP and CLI can create characters from project images or absolute local image paths. The browser HTTP route accepts uploads and project images only.

## Storage

Character records live in `character-library.sqlite` inside the data directory. Images are stored once by content hash under `characters/`, so the same image used by several characters takes space once.

## Limits

Characters do not start generation. The Canvas composer does not attach the main image and brief automatically yet; that comes next. Viral Hit does not create Soul IDs, and it does not measure face or product similarity in generated media.
