# Active Context

*Last Updated: 2026-08-19 00:58 IST*

## Current Tasks
- **T14: Sync Direction Dropdown + Policy Settings UI** - ✅ Implemented; 17 tests and production build pass
- T13: **Safe Cross-Device Reconciliation** - ✅ MERGED. Reconciliation panel code present but will be temporarily disabled in favor of sync direction dropdown + policy settings. T13c (shared manifest/tombstones) deferred.
- T5: **Sync History Log** - User's #2 priority (🔄 Next after T14)
- T6: Selective Sync - User's #3 priority (🔄)
- T7: Sync Pause and Resume - User's #4 priority (🔄)
- T10: Trash Mode and Snapshots - User's #7 priority (🔄, needs refinement)
- T11: Chunked Downloads - User's #8 priority (🔄)

## Recently Completed (2026-08-19)
- **T13: Safe Cross-Device Reconciliation** - ✅ Reviewed, approved, merged to main. T13a/T13b implemented. Reconciliation panel code preserved but will be conditionally disabled in favor of sync direction dropdown.
- **T13 review**: Build clean, 15/15 tests pass. Minor notes: dry-run blocked by reconciliation, `use-local` on remote-only deletes remote file, WebDAV MOVE capability not checked.
- T2 branch-aware updater: ✅ Complete (merged)
- T9 Atomic Writes: ✅ Partial (merged) - local temp+rename, WebDAV temp PUT+MOVE

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
