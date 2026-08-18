# Multi-Pass Sync Architecture

**Date**: 2026-08-17
**Updated**: 2026-08-18
**Related Tasks**: T3a, T8, T12 (all subtasks)
**Status**: ✅ Implemented

## Overview

The sync engine was restructured from a single-pass sequential model into a **three-phase pipeline** with **size-based progress tracking**. This enables accurate progress bars, pre-sync summaries, and deletion detection.

## Architecture

```
┌──────────┐     ┌──────────┐     ┌──────────┐
│  Phase 1 │ ──► │  Phase 2 │ ──► │  Phase 3 │
│   Scan   │     │ Compare  │     │ Transfer │
└──────────┘     └──────────┘     └──────────┘
```

### Phase 1: Scan
- List all local files via `VaultScanner`
- List all remote files via `WebDAVAdapter` (PROPFIND with depth)
- No decisions made — pure data collection

### Phase 2: Compare
- Build sync plan by comparing local vs remote file sets
- Uses `SyncIndexManager` to skip unchanged files (T12d)
- Detects deletions: files present in index but missing locally or remotely
- Produces `SyncPlan` with counts and byte totals

### Phase 3: Transfer
- Execute uploads, downloads, and deletions
- Size-based progress tracking (bytes transferred, not file count)
- Parallel execution with concurrency limit (T12b)
- Updates sync index incrementally via `patchIndex()`

## Dry Run Variant (T8)

Dry run reuses Phase 1 (Scan) and Phase 2 (Compare) but **skips Phase 3 (Transfer)**:

```
┌──────────┐     ┌──────────┐
│  Phase 1 │ ──► │  Phase 2 │
│   Scan   │     │ Compare  │
└──────────┘     └──────────┘
                        │
                        ▼
              ┌─────────────────┐
              │ showDryRunResult │
              │   (preview UI)   │
              └─────────────────┘
```

- Zero actual transfers
- Shows 🧪 preview cards with planned operations
- Loads sync index; if index is missing, ALL files appear as changes

## Pre-Sync Summary

Before starting transfer, the sidebar shows:

```
12↑ 45 MB · 3↓ 12 MB · 1🗑 · 1,693⏭
```

- `↑` = uploads (count + bytes)
- `↓` = downloads (count + bytes)
- `🗑` = deletions (count)
- `⏭` = unchanged / skipped (count)

## Progress Tracking

Progress is measured in **bytes**, not files:

```typescript
const totalBytes = plan.bytesToUpload + plan.bytesToDownload;
const currentBytes = uploadedBytes + downloadedBytes;
const percent = Math.round((currentBytes / totalBytes) * 100);
```

This gives accurate ETA and progress for mixed-size file sets.

## Duration Formatting

Raw seconds are formatted as human-readable durations:

| Input | Output |
|-------|--------|
| 45 | `45s` |
| 154.3 | `2m 34s` |
| 3600 | `1h 0m` |

## Current Deletion Detection Limitation

With only a local sync index (T12d), the current deletion detection works as follows:

1. If a file is in the index but missing locally → schedule remote delete (or vice versa)
2. If a file is in the index but has a different remote ETag → it was modified remotely
3. Files not in the index are treated as new

## Lessons Learned

### saveSettings() Index Wiping Bug (2026-08-18)

`saveSettings()` was calling `indexManager.clear()` on **every** settings save — even trivial toggles like auto-update or concurrency slider changes. This caused:
- Full re-uploads (~45 min) every time settings were touched
- Dry run showing 1,710 downloads because the index was deleted before it could be loaded

The intended fix is to clear the index only when server config (URL, username, password, baseDir) actually changes. The current source still needs a true pre-change settings snapshot; the settings UI mutates the shared object before calling `saveSettings()`, so this remains an open correctness issue until verified by tests.

**Prevention**: Any setting change that invalidates cached state needs a narrow, explicit invalidation condition — not a blanket clear on save.

## Files Modified

| File | Role in Multi-Pass |
|------|-------------------|
| `src/sync/VaultSyncEngine.ts` | Orchestrates 3 phases |
| `src/sync/SyncPlan.ts` | Builds plan with byte totals |
| `src/sync/SyncIndex.ts` | Enables unchanged-file skipping |
| `src/ui/SyncSidebarView.ts` | Displays pre-sync summary + live progress + dry run results |
| `src/main.ts` | Wires progress callbacks, `performDryRun()` |

## Acceptance Criteria

- [x] Pre-sync summary shown before transfer begins
- [x] Progress bar tracks bytes, not file count
- [x] Duration formatted as `Xm Ys` instead of raw seconds
- [x] Deletion detection works via sync index
- [x] Cancel stops cleanly between phases

## Planned T13 Extension

The three phases remain useful, but Phase 2 must distinguish normal comparison from first-sync reconciliation:

- without a trusted shared baseline, local-only and remote-only paths are ambiguous and must wait for a policy or user decision;
- with a shared manifest, deletion tombstones distinguish stale offline copies from genuinely new files;
- Phase 3 must execute only approved decisions and commit the local cache plus remote manifest after complete, verified success;
- partial or cancelled runs must not create a new baseline;
- Dry Run should expose the reconciliation plan without creating the remote base directory or applying transfers.

See `tasks/T13.md` and `implementation-details/cross-device-reconciliation.md`.
