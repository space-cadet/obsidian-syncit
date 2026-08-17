# T3a Implementation: Sidebar-Native Progress Display

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

## UI Elements Added to Sidebar

### Progress Section (shown during sync)
- Progress bar (`<div>` with fill width)
- Percentage text
- Stat counters (uploaded, downloaded, skipped, conflicts)
- Cancel button

### File Log Section (shown during sync)
- Collapsible or auto-showing
- Last 20 operations with icons
- Auto-scrolls to latest
- Cleared on next sync

## Methods Added to SyncSidebarView

```typescript
setPlan(plan: SyncPlan): void
updateProgress(current: number, total: number, operation: string, path: string): void
markFileDone(path: string, operation: string, meta?: { size?: number }): void
finish(result: SyncResult & { message: string }): void
clearProgress(): void
```

## CSS Classes

```css
.syncit-sidebar-progress { height: 4px; background: var(--background-modifier-border); }
.syncit-sidebar-progress-fill { height: 100%; background: var(--interactive-accent); }
.syncit-sidebar-log { max-height: 200px; overflow-y: auto; }
.syncit-sidebar-log-item { display: flex; gap: 6px; padding: 3px 0; }
```

## Migration from Modal

1. Copy stat card logic from `SyncProgressModal` to sidebar
2. Copy file row rendering from modal to sidebar log
3. Replace modal open/close with sidebar method calls
4. Delete `SyncProgressModal.ts` (or keep for reference)

## Testing

1. Start sync → sidebar shows progress
2. Close sidebar → sync continues (by design)
3. Reopen sidebar → picks up current state
4. Cancel → sidebar shows "Cancelled", button reverts
5. Finish → sidebar shows "Ready" with last sync time
