# T3a: Sidebar-Native Progress Display

**Status**: ✅ **COMPLETE**
**Parent**: T3
**Priority**: P1
**Created**: 2026-08-17
**Completed**: 2026-08-17

## Problem

The current sync progress is shown in a modal (`SyncProgressModal`) that:
- Blocks interaction with the rest of Obsidian
- Is confusing when closed — sync continues in background with no visible progress
- Doesn't match Obsidian's design pattern of using sidebars for persistent operations

## Solution

Move all sync progress UI from the modal into the **existing sidebar** (`SyncSidebarView`). The sidebar becomes the single source of truth for sync state.

## Design

### Sidebar During Sync

```
┌─ SyncIt ─────────────┐
│ 🔄 Syncing...        │  ← status
│ ████████░░ 67%       │  ← progress bar
│                      │
│ 📄 12 uploaded       │  ← live counters
│ 🔄 3  downloaded     │
│ ⏭️  45 skipped       │
│ ⚠️  0  conflicts     │
│                      │
│ [Cancel]             │  ← cancel button (replaces "Sync Now")
│                      │
│ ▼ Recent files       │  ← collapsible file log
│   Notes/foo.md    ↑  │
│   Projects/bar.md 🔄 │
│                      │
│ [Settings]           │
└──────────────────────┘
```

### Sidebar When Idle

```
┌─ SyncIt ─────────────┐
│ ✅ Ready             │
│ Last sync: 16:20     │
│                      │
│ [Sync Now]           │
│ [Settings]           │
└──────────────────────┘
```

## Implementation Plan

1. **Extend `SyncSidebarView`** with progress methods:
   - `setPlan(plan)` — show pre-sync summary
   - `updateProgress(current, total, op, path)` — live operation updates
   - `markFileDone(path, op, meta)` — append to file log
   - `finish(result)` — show completion state
   - `clearProgress()` — reset to idle state

2. **Remove modal from `main.ts`**:
   - Delete `SyncProgressModal` instantiation
   - Route all progress callbacks to sidebar
   - Keep cancel logic (abort adapter)

3. **Optional: Keep a minimal toast**
   - `new Notice("Sync started — see sidebar for details", 3000)`
   - Auto-dismisses, non-blocking

## Files to Modify

- `src/ui/SyncSidebarView.ts` — Add progress UI elements and methods
- `src/main.ts` — Remove modal, wire progress to sidebar
- `styles.css` — Progress bar, file log, counter styles

## Acceptance Criteria

- [x] Sidebar shows live progress during sync
- [x] Progress bar updates per operation
- [x] File log shows last N operations (scrollable)
- [x] Cancel button appears during sync, disabled when idle
- [x] No modal is shown during normal sync
- [x] Status bar still updates (lightweight backup)
