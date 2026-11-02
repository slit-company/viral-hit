# 019: Review links, comments and roles

## Decision

Collaboration uses links rather than accounts. The owner creates a link with a role, `viewer` or `editor`. A random 24-byte token is returned once, and only its SHA-256 hash is stored in `collaboration.sqlite` in the data directory. Each request with the token resolves to a guest actor for one project. Unknown and revoked tokens look the same (404).

## Command boundary

`persistViralHitCommand` takes an optional `actor`. The owner is the default, so the UI, MCP and CLI keep their behaviour. A share link calls it with origin `guest` and its actor. `commandDenial` runs before anything is read or saved: viewers run nothing, and editors run `editor.apply` and `editor.validate` on their own project. The `guest` origin also gets the external checks that MCP and the CLI already had: it cannot replace the timeline document, and Canvas asset references are validated. Failures use a new `FORBIDDEN` code (HTTP 403).

## Comments

Comments store an author name, the kind of author (owner, agent or guest), the link that wrote them, a plain-text body and an anchor: a timeline time, a clip, an asset or nothing. Owners and editor links settle any comment. A viewer settles only comments written through the same link, which the review page knows from a `mine` flag. Only the owner deletes comments. The editor polls every 20 seconds, so notes arrive while someone edits.

## Surfaces

The owner works in the header's **Share project** dialog and the editor's **Comments** dialog. Reviewers use `/shared/<token>`, a standalone page with the newest `timeline_render` cut and the comments. Agents use `viral_hit_comments` (`list`, `comment`, `resolve`); making links stays with the owner.

## Evidence and limits

Unit tests cover the role rules. A browser test makes viewer and editor links, sends a comment from the review page, gets 403 for a viewer's command and 200 for an editor's caption edit, then settles the comment in the editor and revokes a link, which then shows as inactive. There are no accounts, presence or simultaneous editing in one screen, and reaching the computer from outside is left to the operator's network.
