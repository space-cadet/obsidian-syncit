# Dedicated Sync Operations Record

*Created: 2026-09-03 12:31 IST*
*Last Updated: 2026-09-03 12:31 IST*
*Related Tasks: T5, T5a, T5b, T5c, T5d, T13, T16c*
*Status: Design recorded; implementation pending*

## Purpose

Define a user-facing audit trail of file operations without turning SyncIt into a Git-like snapshot system. The record describes what SyncIt attempted and what happened; it does not store file contents, diffs, or rollback data.

## Separate destinations

| Destination | Role | User-facing audit source? |
|---|---|---|
| `.obsidian/plugins/obsidian-syncit/debug.log` | Internal plugin diagnostics and logger write diagnostics | No |
| `.syncit/log.jsonl` | General structured application events, lifecycle messages, index/updater events, and current failure records | No, after migration to the dedicated source |
| `.syncit/sync-operations.jsonl` | One metadata record per file operation | Yes |

The dedicated record must not be suppressed because the general application log minimum level is set to `ERROR`. Its retention may reuse the configured age and size limits, but its persistence semantics must be independent from diagnostic verbosity.

## Record contract

Each line is one JSON object with at least:

```text
timestamp
sessionId
operation
status
path
phase
```

Optional safe metadata includes:

```text
bytes
targetPath
durationMs
errorCode
safe details
```

Operations are `upload`, `download`, `conflict`, `local-delete`, and `remote-delete`. Status values are `started`, `succeeded`, `failed`, and `cancelled`. A `planned` status is allowed only if the product chooses to persist dry-run plans, and it must be visibly distinct from an executed operation.

## Lifecycle rules

1. Generate or receive the sync session ID before planning or transfer.
2. Emit a success record only after the underlying local or WebDAV operation completes successfully.
3. Emit a failure record once for a failed operation, using the existing sanitized failure details.
4. Do not emit success for an operation interrupted by cancellation or an exception.
5. Include `targetPath` for keep-both conflict copies and preserve the original path separately when needed.
6. Keep reconciliation decisions and remote manifest/tombstone events correlated by session but distinguish them from ordinary file transfers.

## Storage and performance

- Queue records in memory and flush in batches.
- Reuse the existing JSONL retention and sanitization behavior where safe.
- Do not block a transfer on a per-file storage round trip.
- Bound Activity and Errors rendering with the existing pagination contract.
- Keep malformed-line handling deterministic and preserve readable newer records.
- Treat operation-log write failures as observable logging failures; they must not falsely report a transfer failure or corrupt the vault operation itself.

## Viewer integration

Activity should read successful, failed, cancelled, and optionally planned operation records from the dedicated file. Errors should show failed operation records from that same source. General lifecycle messages can remain in a separate diagnostics view or be retained as legacy Activity entries during migration, but they must not obscure the per-file audit trail.

## Dry-run policy

The recommended initial policy is to keep dry-run planned changes in the UI only and persist only actual attempted operations. If persistent dry-run records are later required, they must use `status: planned`, carry a dry-run marker, and never count toward completed uploads/downloads/deletes.

## Security and privacy

- Never store file contents, hashes that are not already part of the approved metadata contract, passwords, authorization headers, access tokens, or request payloads.
- Sanitize error messages and nested details before enqueueing.
- Keep paths visible because paths are the purpose of this audit record, while allowing the viewer to truncate display safely.

## Verification plan

- Unit-test one success record for every operation type.
- Test failure, cancellation, duplicate prevention, session correlation, and keep-both target paths.
- Test that general `ERROR` verbosity does not suppress operation records.
- Test batched flush, retention, malformed lines, and storage failures.
- Test Activity and Errors filtering, pagination, and separation from `debug.log` and `.syncit/log.jsonl`.
- Run production build and the complete existing test suite.
- Perform manual Obsidian acceptance with a large sync, a cancelled sync, failures, and a dry run.
