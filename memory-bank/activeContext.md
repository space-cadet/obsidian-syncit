# Active Context

*Last Updated: 2026-08-18 12:04 IST*

## Current Tasks
- T13: **Safe Cross-Device Reconciliation and Shared Sync State** — P0 data-safety work (🔄 T13a implemented; T13b next)
- T5: **Sync History Log** — User's #2 priority (🔄 Next)
- T6: Selective Sync — User's #3 priority (🔄)
- T7: Sync Pause and Resume — User's #4 priority (🔄)
- T9: Atomic Writes — User's #6 priority (🔄 atomic text write path implemented; remote orphan cleanup and binary validation remain)
- T10: Trash Mode and Snapshots — User's #7 priority (🔄, needs refinement)
- T11: Chunked Downloads — User's #8 priority (🔄)

## Recently Completed (2026-08-18)
- T8: Dry Run Mode ✅ — `performDryRun()`, 2x2 button grid, scan spinner, debug logging
- Persistent sync log UI ✅ — always-visible, 200px minHeight, dynamic header
- Build metadata injection ✅ — commitHash + buildDate in manifest for stable and dev CI builds
- Signature normalization ✅ — `makeServerSignature()` trims whitespace, strips trailing slashes
- Critical bug fix attempted: `saveSettings()` no longer blanket-clears the index, but pre-change settings capture still requires source-level repair and tests

## Known Issues / Decisions
- `.obsidian/` folder sync: **Not possible** with `app.vault.getFiles()` — Obsidian API excludes dot folders by design. Would require rewriting VaultScanner to use `app.vault.adapter.list()` (obsidian-ai pattern). Deferred.
- Dry run "1710 downloads" root cause: `saveSettings()` was wiping sync index before dry run could load it. The blanket clear was removed in fd784b2, but the current source still needs a true pre-change settings snapshot because the settings UI mutates the shared object before calling `saveSettings()`.
- Debug logging: Writes to `debug.log` file (not console) — user preference for production builds
- New-device reconciliation: local-only and remote-only files are ambiguous without a shared baseline. Do not silently upload or delete them.
- Cross-device deletion: the local sync index cannot record deletions for another device. T13 plans a remote manifest with tombstones.
- T8 is complete as a preview-only dry run; its missing confirmation/apply flow is now part of T13.
- T4 ETag capture is complete, but conflict UI, keep-both, move detection, and shared deletion history remain planned under T13.
- T13a now blocks ambiguous first-sync and possible-deletion plans before transfer. T13b must add the explicit decision UI; T13c must add the shared manifest and tombstones.
- T9 now writes local files through same-directory temporary paths and adapter rename, and remote files through temporary WebDAV PUT plus MOVE. Failed writes clean up temporary files; tests cover success, write failure, rename/MOVE failure, and local startup cleanup.

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
