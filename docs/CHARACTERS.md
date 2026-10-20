# Characters

A character keeps a person, mascot or product looking the same across shots. It is a set of reference images plus written rules: what must always stay the same and what must never change. Create one under **Characters**, then add it to any project from that project's **Assets** view.

Adding a character copies its reference images into the project once, as reference assets, and shows a brief to put in prompts, for example:

> Mina Fox (mascot): Orange fox mascot with a calm smile. Keep exactly: white chest patch; round glasses; lime scarf. Never: extra fingers.

On Canvas, open the image reference menu of a draft and choose the character under **Characters**: the main image is placed beside the draft and attached as a reference, and the brief is added to the prompt. Choosing it again reuses the image already on the canvas and leaves the prompt alone. Adding the same character again anywhere reuses the copies that are already in the project. Archiving a character hides it from the library; projects keep the images they already have.

## What a character holds

| Field | Purpose |
|---|---|
| Name, type, description | Who or what it is: person, illustrated, mascot, product or other |
| Reference images | Up to 20 PNG, JPEG or WebP images of up to 20 MB each. One is the **main image**; others are labeled other angle, expression, outfit or detail |
| Always keep / Never change | Up to 24 short rules each, written into the brief |
| Voice direction | Optional note for narration or TTS |
| Provider identities | Optional IDs from a provider, such as a Higgsfield Soul ID, so an extension can use the provider's own identity model |

The first image becomes the main image unless you choose another. Every change raises the version, and each change must name the version it was based on, so two tabs or agents cannot silently overwrite each other. Images are checked with FFprobe before they are stored.

## Share a character

A brand mascot, a product or a recurring host often needs to look the same in more than one installation. Open the character and choose **Download character file** to get a `.viralhit-character.tar` with every reference image and rule; on the other side choose **Import character** on the Characters page.

Importing always adds a character and never changes an existing one. Importing the same file again returns the character it created, and an id already used by a different character gets a new id. Every image is checked against the hash in the file and probed again before it is stored, so a damaged or edited file is refused. The file is a plain tar readable with `tar -tf`: `manifest.json` (kind `viral-hit-character`, the profile and the reference list) followed by `media/<sha256>` for each image, up to 20 images of 20 MB.

## Agents and scripts

UI, HTTP, MCP and CLI use the same service.

| Surface | How |
|---|---|
| UI | `/characters`, and **Assets → Characters** in a project |
| HTTP | `GET /api/app/characters`; `POST /api/app/characters` with a JSON request, or multipart `request`, `roles` and `file` fields for uploads; `GET /api/app/characters/<id>/file` to download and `POST /api/app/characters/import` with the tar as the body to import |
| MCP | `viral_hit_character` with actions `list`, `get`, `create`, `update`, `add_references`, `remove_reference`, `set_canonical`, `archive`, `use`, `export`, `import` |
| CLI | `pnpm character list`, `get <id>`, `use <id> <project-id>`, `export <id> <file>`, `import <file>`, `request <request.json>` |

MCP and CLI can create characters from project images or absolute local image paths. The browser HTTP route accepts uploads and project images only. Agents attach a character on Canvas by calling `use`, then `viral_hit_canvas_apply` with an image asset card for the main image and a draft that lists it in `referenceCardIds` and includes the brief in its prompt.

The bundled agent skill `consistent-characters` (`viral_hit_skill_get`) walks an agent through finding or defining a character, adding it to a project and Canvas draft, and revising it after a version conflict.

## Storage

Character records live in `character-library.sqlite` inside the data directory. Images are stored once by content hash under `characters/`, so the same image used by several characters takes space once.

## Limits

Characters do not start generation. Only the main image is attached on Canvas; other angles stay in the project assets to attach by hand. Viral Hit does not create Soul IDs, and it does not measure face or product similarity in generated media.
