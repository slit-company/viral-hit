# Consistent characters

Use this skill when someone wants the same person, mascot or product to look the same across images or shots, mentions a character, mascot, spokesperson, influencer or product they reuse, or asks to put an existing character into a project or Canvas draft. A character is reference images plus written rules. It never starts generation by itself.

## Find or define the character

1. Call `viral_hit_character` with `{ "request": { "action": "list" } }` and match by name and description. If one fits, call `get` and use it; do not create a duplicate.
2. To create one you need a name, a type (`person`, `illustrated`, `mascot`, `product` or `other`), a one-sentence description and at least one image. Images come from the project (`{ "projectId", "assetId", "role" }`) or an absolute local path (`{ "path", "role" }`). PNG, JPEG or WebP, up to 20 MB each and 20 per character.
3. Make the clearest front view the `canonical` (main) image. Label the rest `angle`, `expression`, `outfit` or `detail`. Without a canonical image the first one becomes main.
4. Write `invariants` as short visible traits that must stay fixed (colors, marks, accessories, proportions, logo placement) and `forbidden` as concrete changes to avoid (extra fingers, a different logo). Use what the user said and what is plainly visible. If you inferred a rule from an image, show the lists to the user and create the character after they agree.
5. Put a voice note in `voice.direction` only if the user gave one. Record a provider identity such as a Higgsfield Soul ID in `providerIdentities` only when the user supplies an existing ID; it is a record, and Viral Hit does not create one.
6. Create a character of a real person only from images the user provides for that purpose.

## Use it in a project

1. Call `{ "action": "use", "id", "projectId" }`. It copies the references into the project once (repeating it adds nothing) and returns `brief` and `assets` with each `assetId`, `role` and `publicUrl`.
2. To attach it to a Canvas draft, call `viral_hit_canvas_get` first. Reuse an image asset card whose `assetId` is the canonical asset if one exists; otherwise add `{ "type": "upsert_card", "card": { "id", "kind": "asset", "type": "image", "name", "assetId", "url": publicUrl } }`.
3. For an existing draft, send `set_references` with the draft's current `referenceCardIds` plus the character card, and `upsert_card` for the draft with its fields unchanged except the prompt, which gains the brief once. For a new draft, create it with `referenceCardIds` set and the brief in the prompt, then `place_card` it beside the reference.
4. Attach other angles only when the shot needs that view and the draft model accepts more references. In the Canvas UI the user can do the same from the draft's image reference menu under **Characters**.

## Check a result

1. After images or takes exist, call `viral_hit_shot` with `{ "request": { "action": "face", "assetIds": [...], "characterId": "<id>" } }`. Use `referenceAssetIds` with project images instead when there is no library character. Up to 12 files per call; each video is sampled at up to eight frames.
2. Read `status` for each file. `match` means most frames reach the same-person threshold of 0.363, `mixed` means the face drifts in some frames (see `lowest` for when), `different` means no frame matches, and `no-face` means no human face was found.
3. For `mixed` or `different`, offer a re-render with a clearer front view as the reference or a calmer camera move. Do not delete takes.
4. If the reply says setup is needed, tell the user to run `pnpm character face-setup` (and install `opencv-python-headless` if asked). Never try to install it yourself.

## Revise

1. Every change (`update`, `add_references`, `remove_reference`, `set_canonical`, `archive`) needs `expectedVersion` equal to the current `version`. On a version conflict, call `get`, reapply only the user's change to the new version and tell them it had changed.
2. `update` replaces only the fields you send; send the whole `invariants` or `forbidden` list when changing it. Change the main image with `set_canonical`; the old main image becomes an angle.
3. Archive only when the user asks. Projects keep the images they already have.

## Boundaries

- Characters change the library and project assets only. Generating, rendering and publishing are separate requests; paid generation needs the user's approval for that run.
- Report what was attached and the brief you added. Claim a generated result keeps the character only when the face check says `match` or the user has compared it. The check covers human faces only, so mascots and products still need the user's eye.
- The same steps exist in the UI (**Characters**, **Assets → Characters**, Canvas reference menu) and the CLI (`pnpm character list | get | use | request`).
