# Interface plan: Higgsfield-like layout with SEED components

Goal: give Viral Hit the layout and flow people know from Higgsfield while keeping the light SEED look the user chose. We copy structure and interaction patterns, not Higgsfield's artwork, copy or dark theme. Every surface uses the shared SEED layer (`Action`, `Dialog`, `Input`, `NativeSelect`, SEED tokens) under the [structure rules](architecture/STRUCTURE.md).

## What we observed

Captured with Aside on 2026-10-23; local evidence is under `research/evidence/higgsfield-ui/` (ignored, not redistributed).

| Higgsfield surface | Pattern | Viral Hit equivalent today |
|---|---|---|
| Home | Bento grid of large media cards, each with a title and one line; small tool tiles with icon, title and line; promo hero | Headline, prompt box and three plain icon cards |
| Image page | Full-bleed hero media, large headline, floating prompt card with "+" sources, model chip, aspect chip and a large lime Generate button | Studio composer docked at the bottom, near-black round submit |
| Supercomputer | Left sidebar (new, projects, skills, connectors), centered greeting and composer, category chips, template card grid (cover, icon, title, tag) | Recipes only inside the Runs dialog, without covers or categories as browsable cards |
| Cinema Studio | Left sidebar with projects, composer with reference count and setting chips, project grid below | Storyboards and Runs as separate header buttons |
| Top bar | Feature links in one row with "New"/"Free" badges | Short text nav on home pages; pill nav in project workspaces |

## Principles

- **Light SEED theme stays.** Warm-white surfaces, near-black ink text, Pretendard. Brand lime is reserved for the main Generate action and "New" badges, matching Higgsfield's lime call to action.
- **Media first.** Cards lead with an image. Shipped surfaces use generated covers in the established night-blue Studio mood; every installed recipe gets a cover by category, so third-party recipes look complete without extra fields.
- **Open source shows in the UI.** Templates come from the live recipe catalog and packs. General and specialized items appear side by side, with their scope, author and category visible. Nothing in the gallery is hardcoded to our own recipes.
- **Lightweight.** No new runtime dependency. Images are 512px WebP or smaller. Each phase records its bundle size.

## Phases

Each phase ends with typecheck, tests, i18n, build, bundle budget, a browser test for the new flow, desktop 1440 and phone 390 captures reviewed with the visual rubric, and one commit.

1. **Home as Explore.** Keep the greeting and composer; add a feature bento (Image, Video, Audio, Storyboards, Edit marked area, Canvas, Editor) and a template gallery with category and scope chips. A template card opens a new project with that recipe selected in Runs (`/studio?recipe=<id>`). Covers: one per recipe category plus the four Studio thumbnails.
2. **Navigation.** Home top bar lists features in one row with badges. Project workspaces get a collapsible left sidebar (Studio, Canvas, Edit, Storyboards, Runs, Assets; library links; recent projects) instead of scattered header buttons. Phone keeps a compact drawer.
3. **Studio composer and results.** Floating composer card: "+" sources, mark area, model, aspect, duration and count chips, large lime Generate. Results as a media grid with hover actions (reuse, open, download).
4. **Projects.** Cover from the latest output, search and sort, and archive so test or finished projects can be hidden.

## Out of scope

Higgsfield's pricing, credits, promotions, community feed and account surfaces. Their media, logos and copy are not reused.

## Progress

- **Phase 1, 2026-10-23.** Home keeps the greeting and adds a Higgsfield-style composer (Image/Video/Audio chips as native radios that work before hydration, large lime Create), a tool bento of nine media cards, and a template gallery fed by `/api/app/recipes`. General recipes and pack scopes share one chip; specialized appears when a specialized pack is installed. Nine cards show first, with "Show all". A card links to `/studio?recipe=<id>`; after the explicit Studio start, Runs opens with that recipe selected and the parameter is removed from the address. An uninstalled recipe link explains itself. Covers and prompts: [BRAND.md](BRAND.md#explore-covers).
- **Phase 2, 2026-10-23.** Project workspaces on screens 1024px and wider get a left sidebar in the style of Higgsfield's workspace: new project, this project's pages (Studio, Canvas, Edit, Storyboards, Assets, Publish), library (Packs, Skills, Characters, Community, Extensions, Connections) and recent projects. It collapses to icons and remembers that choice. The header drops the links the sidebar now holds; phones keep the header tabs. Storyboards moved into the same project shell, so navigation stays in place there too.
- **Phase 3, 2026-10-23.** Studio results are a grid of square media tiles (two columns on phones, up to four on desktop) with the prompt and time below; the media type and model chip appear on hover and reuse the request, and the tile opens the existing preview. Studio, audio, analysis and Canvas share one labelled lime Generate action. Canvas and Edit start with the sidebar collapsed to keep their working area, remembering that choice separately. A rate-limited precheck now shows its retry message instead of the raw code.
- **Phase 4, 2026-10-23.** Projects can be searched by name and sorted by recent use or name, and "Show more" pages past the 24 most recent (up to 200), so older projects are reachable again. Search runs on the server, matches %, _ and ! literally, keeps text typed before hydration, and is shared with the MCP `viral_hit_project_list` tool. Covers already follow the latest project image; the existing delete action covers hiding test projects, so a separate archive state was not added.

