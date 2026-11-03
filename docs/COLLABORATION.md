# Review links and comments

A project can be shared for review without accounts. The owner makes a link, the reviewer opens it in a browser, watches the newest cut and leaves comments pinned to moments of the video. Comments appear beside the owner's timeline, and agents can read and answer them.

## Roles

| Who | How they arrive | What they can do |
|---|---|---|
| Owner | This computer's app, MCP and CLI | Everything, including making and revoking links |
| Editor link | `/shared/<token>` | Watch, comment, settle any comment, and change the timeline through `editor.apply` commands |
| Viewer link | `/shared/<token>` | Watch, comment and settle comments sent from the same link |

The role is checked where every timeline change already passes: the command path that saves edits with revision checks. A viewer's command is refused with `FORBIDDEN`. An editor link cannot change Canvas, replace the whole timeline, generate, publish or change connections.

## Share a project

1. Open a project and choose **Share project** (the people icon in the header).
2. Pick **Viewer** or **Editor**, optionally name who it is for, and choose **Create link**.
3. Copy the link now. Only a hash of its token is stored, so the full link is shown once.
4. **Revoke** stops a link at once. A revoked or unknown link shows "This link is not active".

Reviewers must be able to reach this computer, for example on the same network or through a tunnel you set up. The app does not open ports or publish anything by itself. The review page asks search engines not to index it and sends no referrer, so the token does not leak through links followed from the page.

## Comments

- **Reviewers** write a name (remembered on their device) and a comment. **Pin to the current moment of the video** pins it to the time of the cut they are watching.
- **The owner** opens **Comments** in the editor toolbar. The count shows open comments. A time chip jumps the playhead there. **Mark as done** settles a comment and **Reopen** undoes it. **Comment at 0:12** pins a new note to the playhead and the selected clip.
- **Agents** use `viral_hit_comments`: `list` returns comments and active links (role and label only), `comment` adds a note as the agent, and `resolve` settles one after acting on it. Agents cannot make or revoke links.

A project keeps at most 20 active links and 1,000 comments. Comments are plain text up to 2,000 characters.

## HTTP

| Request | Purpose |
|---|---|
| `GET /api/app/projects/<id>/collaboration` | Links and comments, for the owner |
| `POST /api/app/projects/<id>/collaboration` | `share`, `revoke`, `comment`, `resolve`, `delete` |
| `GET /api/shared/<token>` | Project name, role, newest cut and comments |
| `POST /api/shared/<token>` | `comment` or `resolve` with a `name`, or `{ "command": ... }` for editor links |

POST requests need the `x-viral-hit-workspace-request: 1` header, like every other change.

## Before you share

Editor links change the timeline through the command API, and the review page plays the newest rendered cut, so render the timeline from the editor or through MCP before asking for review.
