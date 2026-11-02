# Canvas branches and runs

Select a generation card on the Canvas to see **Branch** and **Run changed** at the top. MCP `viral_hit_canvas_run` and `POST /api/app/projects/:projectId/canvas-runs` offer the same actions.

## Run changed

Run changed works out the card's chain, the card and every generation card it uses, and shows **What will run** before anything is spent. Each step either reuses its pinned result or runs, with the reason:

| Shown | When |
|---|---|
| Reuses result | The pinned take was made from the card's current settings and inputs |
| No result yet | The card has no finished take |
| Settings changed | Prompt, model, references or options differ from the pinned take |
| Inputs changed | An input now resolves to a different file, such as a newer take of the card it uses |
| Input runs first | A card it uses runs in this plan, so its input will change |

Confirming queues only the steps that must run, as one durable run in dependency order. The worker passes each new result to the cards that use it. A step whose model, prompt, settings and inputs exactly match an earlier canvas run reuses that result without a new paid request. Takes appear in their cards as the run progresses, the newest take is pinned, and each take records the files it used as inputs. A card that is still generating, an input without a finished result or a reference loop stops the plan with the card's name. While asking before generating is on, a run an agent starts waits for approval ([Agents](AGENT.md)).

Takes made before inputs were recorded count as changed when a card they use has a newer take.

## Branch

Branch copies the selected card and every generation card downstream of it below the originals. Copies keep their settings and reference each other, while inputs outside the branch (uploaded media, earlier cards) stay shared. Copies start without takes. Edit a copy and run it: unchanged copied steps come from the cache, so only the edited part spends credits.

## Storage

Takes live in the canvas document like other takes. Which harness job produced which take, and the settings it ran with, are stored next to the runs in the harness database. The Canvas refreshes takes when it opens and every three seconds while a canvas run is active. Server updates rebuild from the latest canvas on a conflict, so edits made meanwhile are kept.

Evidence: core tests cover planning reasons, legacy takes, blocks and branch rewiring; an integration test runs a real two-card chain through the worker with a fixture provider, reruns only an edited card, and runs a branch whose unchanged image step came from the cache; a browser test drives the plan, the run, the reuse check and a branch. See the [validation ledger](VALIDATION.md#canvas-branches-and-runs--2026-11-03).
