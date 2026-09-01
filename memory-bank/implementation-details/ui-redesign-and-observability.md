# SyncIt UI Redesign and Error Observability

*Created: 2026-09-01 22:45 IST*
*Last Updated: 2026-09-01 23:31 IST*
*Related Tasks: T5, T5a, T5b, T5c, T16, T16a, T16b, T16c, T16d*
*Status: Implementation complete; real Obsidian acceptance pending*

## Purpose

Record the approved redesign and the logging work required to make sync failures understandable. The existing source-level scroll fix is not the target design; this document defines the product structure to implement next.

## Current Evidence

- The approved mockup is saved at `memory-bank/screenshots/2026-09-01-syncit-ui-scroll-owners.png`.
- The redesigned sidebar now separates `Sync`, `Activity`, and `Errors`, with a visible `Rebuild index` action and an explicit vertically scrollable Sync content region.
- Reconciliation is rendered as a table with a single scrollable file list and fixed Cancel/Apply actions.
- `SyncPlan.executePlan()` exposes typed failures, and `main.ts` persists one sanitized `ERROR` entry per failed operation alongside the final summary.
- `SyncLogger` persists `.syncit/log.jsonl`, supports bounded newest-first pages and filters, purges by age and size, and updates the plugin-directory backup at runtime.
- Focused tests cover operation failures, cancellation, redaction, rotation, malformed lines, pagination, and runtime settings.

## Follow-up correction

The index rebuild operation remains a supported command and is now also visible in the Sync sidebar. The normal Sync panel keeps status, action controls, and server information fixed while its main content region scrolls vertically; progress, reconciliation, Activity, and Errors retain their own bounded list owners.

## Product Surfaces

### Sync

Show connection state, last sync, direction, planned file counts, conflict/error emphasis, advanced options, and one primary Sync action. Recent activity is a compact summary, not a second competing full log.

### Activity

Show sessions and operations in a functional viewer with search/filter controls, stable timestamps, operation/path fields, and expandable structured details.

### Errors

Show one row per persisted operation failure, grouped or filtered by sync run. The summary count must link to these records. Error details must be useful without exposing credentials or authorization data.

### Reconciliation

Use a table-like layout with file, reason, and action columns. The file list is the only scrolling region; Cancel and Apply remain fixed and visible.

### Progress

Keep title, progress, counters, and Cancel/Done fixed. Only processed files scroll. Completion must link to Activity or Errors when failures occurred.

## Scroll Ownership

Each surface has one intentional scroll owner:

- Sync: main content region
- Activity: activity list
- Errors: error list
- Reconciliation: file-decision list
- Progress: processed-file list

Headers, filters, status summaries, and actions must be outside the list scroll region. The final row must remain reachable after resize, and the layout must not depend on a fixed pixel height that fails on mobile.

## Logging Contract

The sync engine should expose typed operation failures containing:

```text
operation
path
phase
message
safe details
```

The logger should write one `ERROR` entry per failed operation and retain a summary entry for the complete run. Error text must be sanitized before persistence and display.

The viewer data contract must support level, category, session, search, and time filters plus bounded newest-first pagination or load-more behavior. The viewer must not render an unbounded JSONL file in one DOM operation.

## Log Retention and Rotation

The current product behavior is purge-in-place: after a write, entries older than the age limit are removed and the file is trimmed toward 80% of the maximum size. This behavior must be documented and tested. If archival generations are preferred later, that is a separate design decision and migration task.

The Settings UI must expose:

- minimum log level;
- maximum age in days;
- maximum file size in MB;
- optional plugin-directory backup.

All four settings must take effect without restarting the plugin, and changing backup mode must update the active destination safely.

## Verification

- Unit tests for structured failure creation and persistence.
- Logger tests for level filters, age purge, size purge, malformed lines, and runtime settings.
- Viewer tests for filtering, bounded loading, auto-refresh, and error counts.
- Production build and existing sync tests.
- Manual Obsidian checks at narrow, normal, and resized viewports with long reconciliation lists, long logs, progress lists, and hundreds of errors.

## Related Records

- `tasks/T5.md` owns persistent logging and retention.
- `tasks/T5a.md` owns structured per-file error reporting.
- `tasks/T5b.md` owns maximum-size and rotation reliability.
- `tasks/T5c.md` owns bounded log data access.
- `tasks/T16.md` owns the user-facing redesign.
