# Recovering interrupted timeline edits

The editor backs up unsaved timeline changes in this browser before its debounced network save. **Drafts** opens the local recovery list. Reopening an editor with a retained draft opens the same review automatically. Each editor mount owns a separate draft ID, so two tabs do not overwrite each other's pending changes.

Choose a dated draft, then **Restore draft**. Recovery reads the latest saved timeline and merges it with the draft using the saved base that existed when editing began. Disjoint edits combine. If both versions changed the same content, recovery leaves the saved timeline and original draft unchanged and identifies the affected clip. **Download draft JSON** exports the reviewed snapshot for manual comparison. **Continue editing** closes the review while retaining drafts; it does not discard them. **Delete this draft** removes only the snapshot that was reviewed and refuses to remove a newer copy changed by another tab.

Restoration makes an independent local backup before applying the combined document. The original draft is retired only after the combined timeline is confirmed saved. Restoration is one undoable edit: Undo returns to the latest saved baseline, including unrelated remote changes, and Redo reapplies the merged draft. A response lost after server acceptance can leave a redundant draft; restoring an already-saved draft is harmless. Browser and server export receipts are invalidated when their source no longer matches the merged timeline.

The same protection applies while a save is in flight. Newer local edits are retained and saved after the acknowledged snapshot. If those newer edits conflict with a concurrent server edit discovered during the first save, autosave reports the conflict and preserves the local draft instead of silently writing the newer local value over the server's value.

## Storage and limits

Drafts use this browser origin's local storage. They persist across reloads and normal tab closure, but clearing site data, private browsing cleanup, browser eviction or storage failure can remove them. They are not a server backup or a media archive. They contain timeline data, prompts/text where present and media references, not the source media bytes. Keep project media and server data backed up separately.

Each snapshot is bounded to 4 MiB including its base and pending document, with up to 20 valid drafts per project. Browser-wide quota can be lower than the theoretical aggregate. A failed storage write retains the previous copy and displays an actionable error; network saving can still proceed. No draft is automatically expired or removed to make room. Invalid snapshots remain in storage and are reported as unreadable, without applying them to the project. Downloaded draft JSON is an audit/recovery snapshot, not an automatically executable recipe or a portable project bundle. Use a [project file](PROJECT-FILES.md) to move a project with its media.

A recovery review can include a draft from another currently open tab. Inspect its timestamp and contents before restoring it. Cross-tab collaboration, per-field conflict resolution and importing a downloaded draft through a dedicated UI are still separate work.
