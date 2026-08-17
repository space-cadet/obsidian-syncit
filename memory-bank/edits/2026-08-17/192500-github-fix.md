#### 19:25 IST - GitHub pre-release workflow fix
- **Action**: Modified
- **Files**:
  - `.github/workflows/release.yml` — set `removeArtifacts: false`
- **Details**: Workflow was deleting assets before upload, causing HTTP 502/500 on re-upload. Fixed by preserving existing artifacts. Restored `latest-dev` release with all 4 assets.
- **Commit**: `40b2f3e`
