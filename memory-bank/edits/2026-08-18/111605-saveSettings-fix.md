---
kind: edit_chunk
id: syncit-20260818-6
created_at: 2026-08-18 11:16 IST
task_ids: [T12d]
source_branch: main
source_commit: fd784b218950f5c81da8e2732ee792abd3c24cb3
---

#### 11:16 IST - T12d: Fix saveSettings() wiping sync index
- Modified `src/settings.ts` - `saveSettings()` now only calls `indexManager.clear()` when server config (URL, username, password, baseDir) actually changes
- Previously: index was cleared on EVERY settings save, causing full re-uploads (~45 min) even for trivial toggles
- Root cause of "1710 downloads in dry run" — index deleted before dry run could load it
