---
kind: edit_chunk
id: syncit-20260818-1
created_at: 2026-08-18 11:16 IST
task_ids: [T8]
source_branch: main
source_commit: fd784b218950f5c81da8e2732ee792abd3c24cb3
---

#### 11:16 IST - T8: Build metadata injection in CI workflows
- Modified `.github/workflows/release.yml` - Added `commitHash` and `buildDate` injection into `manifest.json` during stable release build
- Modified `.github/workflows/pre-release.yml` - Added `commitHash` and `buildDate` injection into `manifest.json` during dev build
