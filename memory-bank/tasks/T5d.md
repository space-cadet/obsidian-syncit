# T5d: Dedicated Sync Operations Record

*Created: 2026-09-03 12:31 IST*
*Last Updated: 2026-09-03 12:31 IST*

**Status**: 📋 **PLANNED**
**Parent**: T5 (Sync History Log)
**Priority**: P1 (user-facing auditability and trust)
**Dependencies**: T5, T5a, T5b, T5c

## Objective

Create a dedicated, persistent per-file sync operations record. This is an audit trail of file actions, not a content snapshot system, Git history, or plugin debug log.

## Separation of concerns

- `.obsidian/plugins/obsidian-syncit/debug.log` remains internal plugin diagnostics.
- `.syncit/log.jsonl` remains the general structured application log for lifecycle, index, updater, and failure-summary events.
- `.syncit/sync-operations.jsonl` becomes the user-facing per-file operation history.

## Scope

- Persist one sanitized metadata record for every attempted upload, download, conflict action, local delete, and remote delete.
- Record successful and failed outcomes with the sync session, path, operation, phase, timestamp, and byte count where available.
- Record cancellation without creating false success entries for operations that did not finish.
- Keep operation records independent of the general diagnostic minimum log level.
- Reuse batched writes and safe age/size retention without storing file contents.
- Make Activity and Errors able to read the dedicated record while preserving existing historical general-log entries.

## Proposed record shape

```text
timestamp
sessionId
operation
status
path
phase
bytes
targetPath?
safe details
```

Recommended statuses:

```text
started
succeeded
failed
cancelled
```

The implementation must decide whether to persist `planned` dry-run rows. The safe default is UI-only dry-run plans; if persisted, planned rows must never be presented as completed transfers.

## Implementation notes

- Emit or return operation events from `SyncPlan.executePlan()` only after the underlying action has succeeded or has produced a structured failure.
- Avoid coupling transfer execution to a blocking disk write; enqueue records and flush in batches.
- Preserve exactly-once semantics for each completed operation and pair failures with the correct path and session.
- Keep reconciliation decisions and shared manifest/tombstone events linkable by session but separately modeled.
- Do not silently migrate or delete existing `.syncit/log.jsonl` entries; retain legacy history according to current policy.

## Acceptance criteria

- [ ] A successful upload creates one operation record with the correct path, session, status, and byte count.
- [ ] Successful downloads, local deletes, remote deletes, and conflict actions are recorded similarly.
- [ ] Failed operations create one failed record and do not also create a successful record.
- [ ] Cancellation does not create success records for unfinished operations.
- [ ] The record remains available when the general diagnostic log level is `ERROR`.
- [ ] Credentials, authorization data, file contents, and sensitive request payloads are never persisted.
- [ ] Retention and batching work with large runs without blocking transfer execution.
- [ ] Activity and Errors can filter the operation record by session, operation, status, path, and time.
- [ ] Existing `.syncit/log.jsonl` and `debug.log` remain separate and readable.

## Related records

- `tasks/T5.md` — parent logging and retention task
- `tasks/T5a.md` — structured failure records
- `tasks/T5b.md` — retention and rotation
- `tasks/T5c.md` — bounded data access
- `tasks/T13.md` — reconciliation, manifest, and tombstone decisions
- `tasks/T16c.md` — Activity and Errors viewer
- `implementation-details/sync-operations-record.md` — implementation contract
