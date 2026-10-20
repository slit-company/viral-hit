# Product ad shots

A specialized skill for short vertical (9:16) product ads, launch clips and social posts. It builds on two general skills, `consistent-characters` and `recipe-packs`, and only prepares drafts; it never starts generation or publishing.

## Lock the product

1. Read `consistent-characters` with `viral_hit_skill_get` and follow its steps to find or define the product with `kind: "product"`.
2. Ask the user for the exact label and logo text. Do not read brand text off a small or blurry image. Write it, logo placement, colors, shape and materials as `invariants`; put a changed logo, misspelled text and extra parts in `forbidden`.
3. Show the rules and create the character after the user agrees.

## Plan three shots

Propose this list, adjusted to the product, and write it to Canvas after the user approves it:

| Shot | Draft | Shot line |
|---|---|---|
| Hero | image, 9:16 | Shot: close-up, low angle, 85mm portrait lens, soft studio light, glossy commercial look. |
| Detail | image, 9:16 | Shot: extreme close-up, macro lens, soft studio light. |
| In use | video, 9:16, 5s | Shot: medium shot, eye level, slow push in, natural light. |

1. Each prompt is one sentence about what happens, then the character brief, then the Shot line as the last line. Keep the shot terms exactly as written so the Canvas Shot picker recognizes them.
2. Create each draft with `viral_hit_canvas_apply` using `aspectRatio: "9:16"`, attach the product main image as `consistent-characters` describes, and place the drafts left to right.
3. Report the three draft names and say that nothing has been generated yet.

## Set up the edit

If the user wants the cut prepared, follow `recipe-packs` to review and install the **Short-form reel kit**, then point to its recipes in **Runs**. Queueing a run is a separate request.

## Boundaries

- Use only claims and copy the user approved. Do not add prices, discounts, rankings, health or performance claims.
- Paid generation and publishing need the user's approval for that run.
- Everything here works in the UI as well: **Characters**, the Canvas composer's **Shot** and reference menus, and **Runs → Recipe library**.
