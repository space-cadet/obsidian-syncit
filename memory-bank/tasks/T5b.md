# T5b: Log Size and Rotation Reliability

*Created: 2026-09-01 22:45 IST*
*Last Updated: 2026-09-01 22:45 IST*

**Status**: 🔄 **PLANNED — base implementation exists**
**Parent**: T5 (Sync History Log)
**Priority**: P1
**Dependencies**: T5

## Objective

Give users predictable control over log retention by age and maximum file size, and make rotation reliable when settings change during a running plugin session.

## Current State

- `SyncItSettings.logMaxSizeMB` exists with a 10 MB default and a 1–100 MB Settings slider.
- `SyncLogger._maybeRotate()` runs after writes, removes entries older than the age limit, and trims from the oldest entries until the file is at or below 80% of the configured size.
- The behavior is currently purge-in-place rather than archival rotation into numbered files.
- `backupPath` is calculated at construction time, so toggling the backup setting needs explicit correction and tests.

## Scope

- Keep the maximum-size option visible and clearly described in Settings.
- Define whether “rotation” means purge-in-place or archived generations; document the chosen behavior.
- Make max-age and max-size changes take effect without restarting the plugin.
- Make enabling/disabling the plugin-directory backup update the active destination safely.
- Test exact-threshold, over-threshold, age-only, combined, malformed-line, empty-log, and runtime-setting cases.

## Acceptance Criteria

- [ ] Log settings survive reload with safe defaults for older settings files.
- [ ] A log cannot grow beyond the configured limit after a successful flush/rotation cycle.
- [ ] Rotation preserves the newest valid entries and handles malformed lines predictably.
- [ ] Runtime changes to age, size, and backup settings affect subsequent writes.
- [ ] Tests document purge-in-place behavior or validate archived generations if that decision changes.
