#### 19:25 IST - Multi-pass sync: Scan → Compare → Transfer
- **Action**: Modified
- **Files**:
  - `src/sync/VaultSyncEngine.ts` — restructured into 3-phase pipeline
  - `src/sync/SyncPlan.ts` — byte-based plan totals, pre-sync summary format
  - `src/ui/SyncSidebarView.ts` — pre-sync summary display, size-based progress
- **Details**: Phase 1 Scan lists local + remote files. Phase 2 Compare builds plan with deletion detection via index. Phase 3 Transfer uses size-based progress tracking (bytes, not file count). Pre-sync summary: `12↑ 45 MB · 3↓ 12 MB · 1🗑 · 1,693⏭`. Duration formatting: `2m 34s` instead of `154.3s`.
- **Commit**: `32e1c74`
