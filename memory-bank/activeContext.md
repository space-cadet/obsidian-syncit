# Active Context

*Last Updated: 2026-08-18 11:16 IST*

## Current Tasks
- T5: **Sync History Log** — User's #2 priority (🔄 Next)
- T6: Selective Sync — User's #3 priority (🔄)
- T7: Sync Pause and Resume — User's #4 priority (🔄)
- T9: Atomic Writes — User's #6 priority (🔄)
- T10: Trash Mode and Snapshots — User's #7 priority (🔄, needs refinement)
- T11: Chunked Downloads — User's #8 priority (🔄)

## Recently Completed (2026-08-18)
- T8: Dry Run Mode ✅ — `performDryRun()`, 2x2 button grid, scan spinner, debug logging
- Persistent sync log UI ✅ — always-visible, 200px minHeight, dynamic header
- Build metadata injection ✅ — commitHash + buildDate in manifest for stable and dev CI builds
- Signature normalization ✅ — `makeServerSignature()` trims whitespace, strips trailing slashes
- Critical bug fix: `saveSettings()` index wiping ✅ — only clears index when server config (URL/username/password/baseDir) actually changes

## Known Issues / Decisions
- `.obsidian/` folder sync: **Not possible** with `app.vault.getFiles()` — Obsidian API excludes dot folders by design. Would require rewriting VaultScanner to use `app.vault.adapter.list()` (obsidian-ai pattern). Deferred.
- Dry run "1710 downloads" root cause: `saveSettings()` was wiping sync index before dry run could load it. Fixed in fd784b2.
- Debug logging: Writes to `debug.log` file (not console) — user preference for production builds

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
