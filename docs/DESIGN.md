# Viral Hit interface: SEED components

The user rejected the imported dark interface on 2026-10-19 and requested a light SEED component system. The desktop creative workspace now uses that system: white/app surfaces, near-black ink primary actions, pale lime selection states, Pretendard and restrained separators. Editor media retains its original colors and caption styling.

## Source and adaptation

Reference: private `an earlier design system`, dev commit `6ae567fac92a963f462c3978a4564555e693438e`. Read `DESIGN.md`, `src/styles/tokens.css`, `src/styles/chrome.css`, `src/components/BackButton.tsx`, `src/components/AppPrompt.tsx`, `src/main.tsx` and Vite configuration. The research checkout remains ignored and unchanged.

- `components/base/back-button.tsx` is the shared BackButton, with its Phosphor arrow and SEED ActionButton. Its owned CSS preserves the 44px circular target and hover/pressed/focus states.
- `styles/theme.css` adapts the relevant SEED tokens/chrome. It excludes product, commerce, authentication and analytics code. The app keeps its wide editor layout instead of the consumer app's 470px shell.
- `components/base/action.tsx` uses real SEED ActionButton across project, studio, canvas and editor controls. Component-owned defaults allow the existing dense utility sizing; native pointer and keyboard events are preserved.
- Shared dialogs use SEED ContentDialog, including focus trapping, Escape, close actions and focus restoration. The backdrop lives inside the positioner below the dialog content.
- Recipe text/number inputs use SEED TextField with a single outer focus border. Native file, range, color and geometry controls remain where the editing interaction requires them. Link navigation preserves links and aria-current.
- Light mode is explicit even on a dark OS. Vite resolves `seed-layered` exports, following SEED, so SEED defaults cannot silently override component sizes and colors. The unlayered recipes caused clipped cards and tiny controls during the first migration attempt; actual browser inspection caught this.
- `--vh-*` aliases remain for imported component compatibility, now referencing SEED colors. Existing white-on-dark literals were replaced at their owning components instead of a global button/article override.

Pinned package versions match SEED: `@seed-design/react` 2.4.1, `@seed-design/css` 2.6.1, `@seed-design/vite-plugin` 2.1.0, `@phosphor-icons/react` 2.1.10 and Pretendard 1.3.9. SEED/Phosphor/font package licenses remain with the dependencies. SEED has no repository-wide open-source license; the requested company component reuse is recorded separately from the Apache-licensed upstream editor foundation. This repository remains private; the record does not claim that all of SEED is open source.

## Validation

Review actual routes at 1440×1000 and the project list/recipe modal at 390×844. Inspect the new logo at header size, controls and selected states, light canvas, modal stacking, field scrolling, queue visibility, keyboard focus and media colors. The frozen rubric and actual captures are under ignored `research/evidence/redesign/`. Earlier dark-UI self-review scores are historical functional-layout evidence, not acceptance of the rejected visual direction.

No Higgsfield performance or model-quality parity is established by this redesign. See the validation ledger for functional tests and remaining benchmark gates. Logo source/prompt: [BRAND.md](BRAND.md).


## Component audit and ownership rules

The current implementation is not mostly copied SEED source components. It combines direct reuse, adapters around the same SEED primitives and editor-specific components. An import audit on 2026-10-19 found 40 of 65 component `.tsx` files directly importing `components/base/`, `components/ui/` or `@seed-design/react`. This is direct dependency coverage, not the percentage of SEED source code reused; it excludes route files and does not count controls or transitive usage.

| Control/layout | Actual implementation | Reuse classification |
|---|---|---|
| Back navigation | shared BackButton with Phosphor/SEED | Direct source reuse |
| Shared actions and buttons | `base/action.tsx`, `ui/button.tsx` wrapping SEED ActionButton | Adaptation using the same primitive |
| Shared modal | `ui/dialog.tsx` wrapping SEED ContentDialog | Adaptation using the same primitive |
| Recipe string/number controls | Feature-local `recipe-parameter-form.tsx` using SEED TextField | Primitive reuse, not copied SEED domain code |
| Colors/type/interaction states | Owned SEED token and chrome subset | Token/style adaptation |
| Timeline, media preview, connected canvas | Editor-specific composition | Product-specific components |

Inspected upstream `SectionHeading.tsx`, `PageHeader.tsx` and `LoadingPlaceholder.tsx` are further reusable candidates. They are not integrated merely by appearing in this table. Prefer the actual SEED heading/header and skeleton pattern when replacing corresponding surfaces; the consumer phone shell and Saju commerce/chat components are not appropriate editor primitives. New shared controls must follow [structure rules](architecture/STRUCTURE.md), with feature behavior kept outside the common UI layer.

### Reference workflow results

Reference recipes reuse the existing Runs dialog, SEED-backed recipe fields, SEED actions and project-asset picker. The new result component uses semantic figures with uncropped frame previews and selected timestamps, five columns on desktop and three on narrow screens. It introduces no alternate control system. Actual 1440×1000 and 390×844 captures and the fixed self-review scorecard are retained locally under `research/evidence/reference-recipes/visual/`.


The publishing connections page uses the shared SEED-backed Button, existing light surface/text/border tokens and the workspace shell; it does not introduce a second control system or claim direct SEED source reuse. Long channel names wrap, account status stays explicit, and disconnect presents inline confirmation with the remote-video/schedule consequence. At phone widths, project mode navigation now occupies a separate header row with text labels, keeping Back, Runs, language, connections and configuration reachable. This fixes a real pointer interception found after adding the connections entry point; horizontal overflow alone did not detect that overlap.


The project Publish page composes the same light shell and SEED-backed Button with shared Input/Textarea and a shared NativeSelect using input tokens. Native video, date/time and checkbox controls preserve browser media, keyboard and mobile behavior. This is primitive/token reuse, not a claim of copied SEED source. Preparation and review are separate columns on desktop and stacked on phones. The retained preview, destination and visibility remain in the review card; only confirmed reviewed revisions can be queued. Status distinguishes local approval from provider observation. The project Publish entry uses its own header icon, preserving the existing four mode tabs.

## Instagram account connections

The Instagram provider card, Page/Instagram selection and account lifecycle reuse the existing shared Button and NativeSelect, ProductPageShell, SEED-based tokens and light surface treatment. These are shared-control/token adaptations, not a new assertion of direct SEED source reuse. Full Page names and both destination IDs remain visible below the native select on mobile. No provider SDK or new browser dependency is introduced.

Real account UI captures at 1440×1000 and 390×844 passed the frozen visual rubric at 4.35/5 (self-review). The flow used real application routes and encrypted account storage with an isolated Meta response fixture, not a real Meta consent/account. Production captures separately show unconfigured Google/Meta controls disabled. Evidence is under `research/evidence/instagram-accounts/`; the failed URL/file evidence-binding attempt is retained, with the corrected binding in `visual-verified/`.


## Instagram publication review

Publish composes separate YouTube and Instagram forms around one destination selector and delivery queue. The Instagram form/card reuse shared NativeSelect, Textarea, Button and the existing light SEED surface tokens. Reel/Story-specific caption and disclosure fields stay in the publishing feature; metadata validation, video inspection and provider calls stay in its server domain. Retained playback and revision-bound approval reuse the established review control. This adds no UI library or direct-source-reuse percentage claim.


Instagram scheduling adds the existing shared Input with a native datetime-local control. Drafts retain the browser-local edit value while reviewed metadata stores an explicit UTC instant. The review card repeats the scheduled time/zone and uses a distinct Approve schedule action and Scheduled in studio waiting label. The existing queue, preview and shared light controls remain the same; no calendar library is added.

Overlay motion uses the shared SEED Action controls and existing native range/select inputs. On screens below 640 px, the same Inspector content opens in the shared SEED dialog with focus management, Escape and focus return; desktop keeps its side panel. This is an adaptation of shared primitives, not a copy of SEED product content.


Creative pack link import composes the existing SEED Action, SEED TextField and light product shell. The link form wraps into a full-width action on phones; review reuses the existing recipes/instructions/reference-image view and retains its explicit confirmation. Installed pack cards show stable IDs and name download actions by title plus ID, so multiple community packs remain distinguishable. This is shared primitive/token reuse.

The Skills lifecycle views reuse SEED Action, the shared dialog and light surface tokens. Update review labels installed/incoming versions, exposes both complete definitions and retained-version download, and requires a comparison checkbox. Removal has a separate revision-specific review. Skill cards expose stable IDs in text and accessible Read names. Native confirmation checkboxes follow the existing pack review pattern.


The storyboard workspace reuses SEED Action, SEED TextField, the shared NativeSelect and ProductShell, plus the existing recipe parameter/asset form and Runs dialog. Feature-local components own plan, shot and review layout. This is SEED-based adaptation and shared token/control reuse, not a claim that the entire page was copied from SEED. Desktop (1440×960) and mobile (390×844) review captures include actual selected video ranges, long titles and saved/draft state.

Video layers reuse the existing Overlay import action, shared inspector and native range controls. The inspector identifies the clip as a visual overlay and exposes audio volume only for video. Native video preview lives inside the existing selectable/draggable layer control; no alternate button, dialog or theme is introduced. Mobile uses the same SEED inspector dialog and scrollable controls.

App inspection reports reuse SEED Action, the existing Runs dialog, native details/summary disclosure and the shared surface/text tokens. Captured labels and source locations render as plain text. Findings retain observed/static-candidate labels and a separate partial-analysis state; the download exports the validated summary. This is shared component/token reuse, with no added browser UI dependency.

### Provider connection form

`components/extensions/provider-connections.tsx` reuses the existing SEED `Action`, SEED `TextField`, `vh-field` and product surface tokens. It adds password-only entry, per-provider save/check/remove actions, and distinct saved/authentication/result states. It does not introduce a separate design system or copy third-party UI assets. Verification targets desktop 1440×1000 and mobile 390×844.
