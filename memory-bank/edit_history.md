# Edit History

*Created: 2026-08-17 12:55 IST*
*Last Updated: 2026-08-18 11:16 IST*

---

## 2026-08-18

#### 11:16 IST - T8: Build metadata injection in CI workflows
- Modified `.github/workflows/release.yml` - Added `commitHash` and `buildDate` injection into `manifest.json` during stable release build
- Modified `.github/workflows/pre-release.yml` - Added `commitHash` and `buildDate` injection into `manifest.json` during dev build

#### 11:16 IST - T3a: Persistent sync log in sidebar
- Modified `src/ui/SyncSidebarView.ts` - Moved file log to always-visible section with `minHeight: 200px`
- Modified `src/ui/SyncSidebarView.ts` - Log header updates dynamically: Recent Activity → Syncing... → Sync complete

#### 11:16 IST - T8: Dry run mode implementation
- Modified `src/main.ts` - Added `performDryRun()` method: scans, builds plan, shows preview, zero transfers
- Modified `src/main.ts` - Added "Dry Run" command to Command Palette
- Modified `src/ui/SyncSidebarView.ts` - Added "Dry Run" button to 2x2 action grid
- Modified `src/ui/SyncSidebarView.ts` - Added `showDryRunResult()` displaying 🧪 preview cards with plan summary

#### 11:16 IST - T8: Debug logging to file
- Created `src/sync/DebugLogger.ts` - Writes debug output to `.obsidian/plugins/obsidian-syncit/debug.log`
- Modified `src/main.ts` - Integrated DebugLogger into dry run flow
- Modified `src/ui/SyncSidebarView.ts` - Removed artificial 20ms per-file delay, now instant after scan

#### 11:16 IST - T3a: Compact button layout and scan spinner
- Modified `src/ui/SyncSidebarView.ts` - Changed action buttons to 2x2 grid layout (Sync Now, Dry Run, Settings, Rebuild Index)
- Modified `src/ui/SyncSidebarView.ts` - Added `setScanning()` showing "⏳ Scanning..." during scan phase
- Modified `src/settings.ts` - Signature normalization: `makeServerSignature()` trims whitespace, strips trailing slashes from URL and baseDir

#### 11:16 IST - T12d: Fix saveSettings() wiping sync index
- Modified `src/settings.ts` - `saveSettings()` now only calls `indexManager.clear()` when server config (URL, username, password, baseDir) actually changes
- Previously: index was cleared on EVERY settings save, causing full re-uploads (~45 min) even for trivial toggles
- Root cause of "1710 downloads in dry run" — index deleted before dry run could load it

## 2026-08-17

#### 21:25 IST - WebDAV href path parsing fix
- Nextcloud returns absolute hrefs like `/remote.php/dav/files/deepak/obsidian-syncit/file.md`
- `hrefToPath()` was only checking for `/obsidian-syncit/` prefix → all files rejected
- Fixed: `getFullPathPrefix()` extracts server path from `baseUrl` + `baseDir`
- Result: Remote scan now correctly returns all files
- Commit: `39f8c8c`

#### 21:14 IST - Updater fix: debug logging, commit hash comparison, error surfacing
- Added `DebugLogger` class → writes to `debug.log` in plugin dir
- `checkForUpdate()` now logs all steps (releases fetched, commit comparison, version comparison)
- Pass `currentCommitHash` from manifest to enable commit-hash dev channel updates
- Surface actual error messages in Notice when update check fails
- Workflow: Inject `commitHash` into `manifest.json` during pre-release build
- Commit: `1c94dc8`

#### 19:25 IST - T4+T12d: ETag support and local sync index
- WebDAVAdapter: capture ETags from PROPFIND `<d:getetag/>`
- SyncIndexManager: persists sync state to `sync-index.json`
- Unchanged files skipped on sync #2+ (no network round-trip)
- Index invalidated when server config changes
- Partial syncs update index incrementally via `patchIndex`
- Commits: `92a8d51`, `c6e1297`

#### 19:25 IST - T3a: Sidebar-native progress display
- Removed blocking modal, moved all progress UI to persistent sidebar
- Progress bar, live stat counters (scanned/upload/skip/overwrite/delete/conflict)
- File log with icons, subtitles, size badges, colored labels
- Completion summary with icon cards and byte totals
- Cancel button integrated into sidebar
- Commits: `dbd6864`, `a849a5f`

#### 19:25 IST - Multi-pass sync: Scan → Compare → Transfer
- Phase 1: Scan — lists local + remote files
- Phase 2: Compare — builds plan with deletion detection via index
- Phase 3: Transfer — size-based progress tracking (bytes, not file count)
- Pre-sync summary: `12↑ 45 MB · 3↓ 12 MB · 1🗑 · 1,693⏭`
- Duration formatting: `2m 34s` instead of `154.3s`
- Commit: `32e1c74`

#### 19:25 IST - GitHub pre-release workflow fix
- Workflow was deleting assets before upload (HTTP 502/500)
- Fixed by setting `removeArtifacts: false` in workflow
- Restored `latest-dev` release with all 4 assets
- Commit: `40b2f3e`

#### 15:50 IST - User: Modal refinements needed (5 issues)
- Modal too big → made compact (360px max, smaller fonts)
- Cards not compact → horizontal stat row
- Lists all files upfront → append-only as processed
- Cards don't update live → counters increment per file
- Cancel button stuck → hides on finish, Done appears
- Redesigned SyncProgressModal with live-updating stats

#### 15:42 IST - CI build failed, fixed
- Stale addLog calls in main.ts → replaced with finish()
- titleEl conflict with Modal base class → renamed to syncTitleEl
- Build passes cleanly

#### 15:30 IST - User: Two issues reported
- Cancel doesn't stop in-flight operations
- Modal doesn't show whether file existed on remote
- Redesigned modal to match screenshot: stat cards + per-file badges
- Added AbortController to WebDAVAdapter for true cancellation

#### 15:03 IST - User: Modal needs richer info
- Requested: file sizes, unchanged count, total transferred, rate, ETA
- Implemented in SyncProgressModal: plan summary, per-file sizes, live stats

#### 14:49 IST - T12a/T12b/T12c: Sync speed optimization — 3 subtasks complete
- **T12a**: Fixed PROPFIND `depth=1` bug — now uses `Depth: infinity` with recursive fallback
  - Files in nested directories are now discovered and synced correctly
  - `WebDAVAdapter.ts`: added `listFilesRecursive()`, `filterFileEntities()`, infinity depth support
- **T12b**: Implemented parallel sync with concurrency limit (default: 3)
  - Added `runWithConcurrency()` helper with `Set<Promise>` pool + `Promise.race()` backpressure
  - Uploads, downloads, conflicts all run in parallel up to the limit
  - Added `concurrencyLimit` setting (1–10 slider) in Performance section
  - Modified: `SyncPlan.ts`, `types.ts`, `settings.ts`, `main.ts`
- **T12c**: Eliminated redundant MKCOL calls
  - Added `createdDirs: Set<string>` to track directories created per session
  - `writeFile()` skips MKCOL if directory already in set
  - Modified: `WebDAVAdapter.ts`
- Build: main.js ~52KB (was ~48KB), passes successfully
- Status: T12 75% complete; T12d (local sync index) remains planned

#### 14:24 IST - T12: Created sync speed optimization task suite
- Created parent task T12 with 4 subtasks (T12a–T12d)
- Created implementation details doc: `sync-speed-optimization.md`
- Updated `tasks.md` and `activeContext.md` registries
- Diagnosed 2 bugs + 2 bottlenecks from code review

#### 13:07 IST - T1: Plugin scaffolded and building
- Created full plugin structure with build pipeline
- Implemented WebDAV adapter (from obsidian-ai proven code)
- Implemented vault scanner, sync plan builder/executor
- Implemented settings UI with connection test
- Build succeeds: main.js (21KB, 645 lines)
- Status bar integration working

#### 12:55 IST - INIT: Memory bank initialized
- Created `memory-bank/tasks.md` - Task registry
- Created `memory-bank/session_cache.md` - Session tracking
- Created `memory-bank/activeContext.md` - Current context
- Created `memory-bank/edit_history.md` - Edit history (this file)
- Created `memory-bank/implementation-details/` - Knowledge layer directory
- Created `memory-bank/tasks/T1.md` - First task: Research & Scaffold
