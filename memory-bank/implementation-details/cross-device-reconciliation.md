# Cross-Device Reconciliation and Shared Sync State

*Created: 2026-08-18 11:45 IST*
*Related Task: T13*
*Status: Planned design; source implementation not started*

## Why the Current Algorithm Is Unsafe on a New Device

The current planner has only two snapshots and a local cache. With no trusted baseline:

- local-only files are treated as new uploads;
- remote-only files are treated as new downloads.

That is reasonable for an empty destination, but unsafe when a device contains an older copy of the vault. A new tablet cannot know that a local file was deleted or moved on a mobile device unless that fact is stored in shared state.

## State Layers

### Local sync index

`sync-index.json` remains a device-local performance cache. It can skip unchanged files after a successful run, but it must not decide what a new device should do with a missing path.

### Remote manifest

Add a versioned manifest under the configured remote base directory, for example:

```text
.syncit/manifest.json
```

The normal file scanner must exclude this path from the vault file set.

Each manifest entry should contain at least:

```text
path
contentHash
size
lastKnownMtime
lastKnownEtag
lastSeenAt
deletedAt?
movedFrom?
```

The manifest should also carry a schema version, vault identity, generation number, and update timestamp. Updates need an ETag or equivalent compare-and-swap check so concurrent devices do not silently overwrite the manifest.

### Tombstones

When a deletion is accepted, retain a tombstone instead of only removing the entry. A stale device that later presents the old path can then be classified as `remote-deleted`, not `new-local-file`.

Tombstones should have a retention period, such as 30 days, and must not expire while the device has an active pending reconciliation. Expiry should be logged.

## Decision Matrix

| Situation | No trusted baseline | Trusted baseline | Default action |
|---|---|---|---|
| Local-only path | Ambiguous | New local or remote deletion | Prompt / policy |
| Remote-only path | Ambiguous | New remote or local deletion | Prompt / policy |
| Both present, one changed | Ambiguous if baseline missing | One-sided change | Apply direction |
| Both changed | Conflict | Conflict | Review |
| Local path matches remote tombstone | Stale local copy | Remote deletion | Archive local; do not upload |
| Same content, different path | Possible move | Possible move | Propose move; review |

No-baseline local-only and remote-only entries must not enter the transfer queues until a policy or user decision resolves them.

## First-Sync Flow

```text
Scan local and remote
        |
Load local cache and remote manifest
        |
Is there a trusted shared baseline?
        |
   no --+--> classify ambiguous paths
        |          |
        |          v
        |     show reconciliation UI
        |          |
        |     user chooses authority/actions
        |
   yes -------> build normal change plan
                   |
                   v
             confirm destructive actions
                   |
                   v
             execute transfers
                   |
                   v
       verify files, then commit manifest and local cache
```

Remote-wins for the Chinese-learning-folder case should archive local-only tablet files to Obsidian trash or a review location, then download the remote structure. It must not permanently delete them as part of the first reconciliation.

## Ongoing Direction Modes

- **Download-only**: remote changes apply locally; local changes are reported but never uploaded.
- **Upload-only**: local changes apply remotely; remote changes are reported but never downloaded.
- **Two-way**: both sides participate after a trusted baseline exists.

Deletion behavior is a separate policy. Upload-only does not automatically mean permanent remote deletion, and download-only does not automatically mean permanent local deletion.

## Reconciliation Actions

For each ambiguous or conflicting path, support:

- upload local;
- download remote;
- keep local;
- keep remote;
- keep both with a deterministic conflict name;
- archive local to trash/review;
- skip and review later;
- apply the decision to this folder or all remaining matching paths.

The decision, actor, time, path, and resulting operation should be recorded by T5's persistent sync history.

## Safe Deletion

The default delete policy is reversible:

- local delete → Obsidian system trash;
- remote delete → WebDAV `MOVE` into `.syncit-trash/<run>/<path>`;
- permanent delete → explicit opt-in;
- ignore → leave the other side unchanged and report the divergence.

If a server cannot perform a safe remote move, the plugin should stop and report the limitation rather than silently falling back to permanent deletion.

## Related Implementation Work

- T4: ETags and conflict metadata.
- T5: JSONL sync history and reconciliation decisions.
- T6: folder selection and folder-scoped decisions.
- T8: read-only preview extended with explicit apply.
- T9: temporary writes and atomic replacement.
- T10: trash, snapshots, retention, and restore.
- T12d: local cache invalidation and post-success cache commit.

## Acceptance Scenarios

1. Mobile reorganizes and deletes files; a new tablet has the old folder. First sync stops for reconciliation, and remote-wins produces the mobile layout without resurrecting stale files.
2. A genuinely new tablet note is added after the baseline. Two-way sync uploads it.
3. A mobile deletion creates a tombstone. An offline tablet later reconnects with the stale file and does not upload it automatically.
4. Both devices edit the same file. The user chooses local, remote, both, or skip.
5. A transfer fails halfway through. The previous baseline remains valid and the next run retries safely.
6. A binary attachment survives upload and download without text conversion.
