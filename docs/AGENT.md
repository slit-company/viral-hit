# Agents

AI agents (Codex, Claude Code and other MCP clients, or scripts using the command line) work in Viral Hit through the same project operations as the UI. The **Agent** page (Setup → Agent) decides two things: whether their generation waits for a person, and what they should remember.

## Ask before generating

With **Ask me** on, generation an agent requests waits until a person approves it on the Agent page, so credits are spent only after approval. Work a person starts in Viral Hit never waits, and nothing is held while asking is off.

- **Queued runs** (recipes, Cinema shots, storyboards, `harness enqueue`): a run with any generation step is created but held. Run lists show it with `held: 1`, the worker leaves it alone, and **Approve** releases it without the agent doing anything. **Reject** cancels it before anything is submitted.
- **Direct generation** (`viral_hit_generation_submit`, the `submit` action of `viral_hit_asset_generation`, and `generation request` on the CLI): the call stops with status 409 and an `approvalId`. After approval the agent repeats the same call, and it goes through once. Repeating it with the same idempotency key or intent token afterwards replays the original submission; a new request needs a new approval. A rejected request stays rejected.
- A badge next to **Runs** in the header shows how many approvals wait.
- Agents read the mode and the approvals with `viral_hit_approvals` (`list`, `get`). They cannot approve, reject or change the mode.

Every MCP tool call, and the CLI commands `harness enqueue`, `generation request`, `storyboard` and `character`, runs as an agent request. A generation step is any operation whose capability declares `generation: true`: installed generation models, Comfy Router, your ComfyUI server and installed adapters marked as generation.

## Memory

Memory keeps short facts that should outlive one conversation: preferences, brand rules and decisions. An entry belongs to the whole workspace or to one project, holds up to 600 characters, and each scope keeps up to 200 entries.

- Agents call `viral_hit_memory` with `list` before creative work (workspace entries plus the project's), `save` for lasting facts the person states (`scope` workspace or project; `id` rewrites an entry), and `forget` for entries that no longer hold.
- On the Agent page a person adds, edits and forgets entries. Each entry shows who wrote it last.
- Memory stays in the local workspace. An agent sees it only when it calls the tool, so keep secrets and keys out of it.

## Storage and API

Settings, approvals and memory are tables in the harness database next to the runs they gate, so the server, the MCP process, the CLI and the worker see the same state without a restart. HTTP, for trusted local requests: `GET /api/app/agent` (overview), `GET /api/app/agent?view=badge` (mode and waiting count) and `POST /api/app/agent` with `set_mode`, `decide`, `remember` or `forget`.

Evidence: core tests cover held, released and rejected runs, one-time direct approvals with key replay, and memory scopes and limits; a browser test drives MCP and the Agent page end to end. See the [validation ledger](VALIDATION.md#agent-memory-and-approvals--2026-11-02).
