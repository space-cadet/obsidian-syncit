# T3a Implementation: Sidebar-Native Progress Display

*Last Updated: 2026-09-01 22:52 IST*

> Historical baseline: this document records the original sidebar-native progress implementation. The approved mockup-based redesign and proper log/error viewer are specified in `ui-redesign-and-observability.md` and tracked by T16.

## Overview

Move sync progress from modal to sidebar. The sidebar becomes the primary (and only) progress surface.

## Architecture

```
┌─────────────────┐
│   performSync   │
│    (main.ts)    │
└────────┬────────┘
         │ progress callbacks
         ▼
┌─────────────────┐
│ SyncSidebarView │
│  (sidebar UI)   │
└─────────────────┘
```

No modal in the flow. A `Notice` toast on start is optional.

## State Machine

```
IDLE ──[Sync Now]──► SYNCING ──[Cancel]──► CANCELLED
   ▲                    │
   │                    │ [Finish]
   │                    ▼
   └─────────────── DONE / ERROR
```

## UI Elements in Sidebar

### Action Buttons (2x2 Grid)
- **Sync Now** — triggers full sync
- **Dry Run** — T8: preview sync without transferring (🧪)
- **Settings** — opens plugin settings
- **Rebuild Index** — rebuilds sync index from scratch

### Progress Section (shown during sync)
- Progress bar (`<div>` with fill width)
- Percentage text
- Stat counters (uploaded, downloaded, skipped, conflicts)
- Cancel button

### File Log Section (always visible)
- `minHeight: 200px` — no longer grows from nothing
- Survives after sync completes
- Dynamic header: Recent Activity → Syncing... → ✅ Sync complete
- Last 20 operations with icons
- Auto-scrolls to latest

### Scan Spinner
- `setScanning()` shows "⏳ Scanning..." during Phase 1 (Scan)
- Used for both Sync and Dry Run

## Methods Added to SyncSidebarView

```typescript
setPlan(plan: SyncPlan): void
updateProgress(current: number, total: number, operation: string, path: string): void
markFileDone(path: string, operation: string, meta?: { size?: number }): void
finish(result: SyncResult & { message: string }): void
clearProgress(): void
setScanning(isScanning: boolean): void        // Scan spinner
showDryRunResult(plan: SyncPlan): void        // T8: dry run preview
```

## CSS Classes

```css
.syncit-sidebar-progress { height: 4px; background: var(--background-modifier-border); }
.syncit-sidebar-progress-fill { height: 100%; background: var(--interactive-accent); }
.syncit-sidebar-log { min-height: 200px; max-height: 200px; overflow-y: auto; }
.syncit-sidebar-log-item { display: flex; gap: 6px; padding: 3px 0; }
```

## Changes from Original Design

| Aspect | Original | Current (2026-08-18) |
|--------|----------|---------------------|
| Log visibility | Shown during sync, cleared on next sync | Always visible, 200px min-height |
| Log header | Static "Recent Activity" | Dynamic: Recent Activity → Syncing... → ✅ Sync complete |
| Buttons | Vertical stack | 2x2 compact grid |
| Scan phase | No visual indicator | "⏳ Scanning..." spinner |
| Dry run | Not present | Dedicated button + preview cards |

## Testing

1. Start sync → sidebar shows progress
2. Close sidebar → sync continues (by design)
3. Reopen sidebar → picks up current state
4. Cancel → sidebar shows "Cancelled", button reverts
5. Finish → sidebar shows "Ready" with last sync time
6. Dry run → shows 🧪 preview cards, no actual transfers
