# Active Context

*Last Updated: 2026-08-19 03:27 IST*

## Current Tasks
- T14: **Sync Direction Dropdown + Policy Settings UI** - ✅ **COMPLETE** (merged to main)
  - UI refactor: mode selector + Sync / Dry Run buttons (separation of intent and action)
  - Replaces the 6-option dropdown with a cleaner 3-mode selector + two action buttons
- T13: **Safe Cross-Device Reconciliation** - ✅ MERGED. Reconciliation panel code present but conditionally disabled via T14.
- T5: **Sync History Log** - User's #2 priority (🔄 Next)
- T6: Selective Sync - User's #3 priority (🔄)
- T7: Sync Pause and Resume - User's #4 priority (🔄)
- T10: Trash Mode and Snapshots - User's #7 priority (🔄, needs refinement)
- T11: Chunked Downloads - User's #8 priority (🔄)

## Recently Completed (2026-08-19)
- **T14: Sync Direction Dropdown + Policy Settings UI** - ✅ Complete. 8 commits on `agent/t14-sync-direction`:
  - `6636b1a` — Initial sync direction + reconciliation policy settings
  - `7105d2e` — Sidebar: single Sync button with dropdown, layout fix
  - `ba40caf` — Updater: branch display, browse builds from all branches
  - `69caf74` — Fix commit hash regex for markdown-bold release body
  - `df30d04` — Fix dev build updates by commit hash instead of semver
  - `d34ec23` — Orphan policies + styled dropdowns
  - `76924d7` — Dry run applies follow-direction reconciliation
  - `7ad84f9` — Sync dropdown shows dry run options per mode
  - `9f7725e` — **UI refactor: mode selector + Sync/Dry Run buttons**
- All builds pass; tests 17/17 throughout.
- **Build fix post-merge:** `276725c` — restored `openSettings()` method signature accidentally broken during `openSyncMenu` removal. Added `@ts-ignore` comment placement.
- **T13: Safe Cross-Device Reconciliation** - ✅ Reviewed, approved, merged to main.

## Recently Completed (2026-08-18)
- T8: Dry Run Mode ✅ - `performDryRun()`, 2x2 button grid, scan spinner, debug logging
- Persistent sync log UI ✅ - always-visible, 200px minHeight, dynamic header
- Build metadata injection ✅ - commitHash + buildDate in manifest for stable and dev CI builds
- Signature normalization ✅ - `makeServerSignature()` trims whitespace, strips trailing slashes
- Critical bug fix: `saveSettings()` index wiping ✅ - only clears index when server config actually changes

## Known Issues / Decisions
- `.obsidian/` folder sync: **Not possible** with `app.vault.getFiles()` — Obsidian API excludes dot folders by design. Would require rewriting VaultScanner to use `app.vault.adapter.list()` (obsidian-ai pattern). Deferred.
- Debug logging: Writes to `debug.log` file (not console) — user preference for production builds
- New-device reconciliation: local-only and remote-only files are ambiguous without a shared baseline. **Decision**: Temporarily disable reconciliation panel; auto-resolve based on sync direction (T14). Will return with proper default policies later.
- Cross-device deletion: the local sync index cannot record deletions for another device. T13c plans a remote manifest with tombstones — deferred until after T14.
- T4 ETag capture is complete, but conflict UI deferred until after sync directions are implemented.
- T9 atomic writes implemented for text files; binary-safe verification and remote orphan cleanup remain.
- T13a/T13b merged but reconciliation panel will be hidden behind policy setting (T14e).
- T14 adds persisted default direction and reconciliation policy settings, plus a per-sync sidebar direction selector. Upload-only/download-only are enforced in planning; ambiguous two-way cases still use the T13 review panel for safety.

## Completed Tasks (Earlier)
- T1: Research & Scaffold ✅
- T2: GitHub Actions + Auto-Updater ✅
- T3: Sidebar UI & Progress Modal ✅
- T3a: Sidebar-Native Progress Display ✅
- T4: ETag capture for conflict detection ✅ (conflict UI deferred)
- T12a: Fix PROPFIND depth ✅
- T12b: Parallel sync with concurrency limit ✅
- T12c: Batch MKCOL ✅
- T12d: Local sync index ✅
- T12: Sync Speed Optimization (parent) ✅
- Multi-Pass Sync Architecture ✅
- GitHub pre-release asset fix ✅ (`removeArtifacts: false`)
