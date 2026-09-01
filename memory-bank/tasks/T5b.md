# T5b: Log Size and Rotation Reliability

*Created: 2026-09-01 22:45 IST*
*Last Updated: 2026-09-01 23:26 IST*

**Status**: ✅ **IMPLEMENTED — purge-in-place behavior retained**
**Parent**: T5 (Sync History Log)
**Priority**: P1
**Dependencies**: T5

## Objective

Give users predictable control over log retention by age and maximum file size, and make rotation reliable when settings change during a running plugin session.

## Current State

- `SyncItSettings.logMaxSizeMB` exists with a 10 MB default and a 1–100 MB Settings slider.
- `SyncLogger` rotates after writes, removes entries older than the age limit, discards malformed lines, and trims oldest entries toward 80% of the configured size.
- The behavior is currently purge-in-place rather than archival rotation into numbered files.
- `backupPath` is updated when settings change; enabling copies the canonical log and disabling removes the plugin-directory backup.

## Scope

- Keep the maximum-size option visible and clearly described in Settings.
- Define whether “rotation” means purge-in-place or archived generations; document the chosen behavior.
- Make max-age and max-size changes take effect without restarting the plugin.
- Make enabling/disabling the plugin-directory backup update the active destination safely.
- Test exact-threshold, over-threshold, age-only, combined, malformed-line, empty-log, and runtime-setting cases.

## Acceptance Criteria

- [x] Log settings survive reload with safe defaults for older settings files.
- [x] A log cannot grow beyond the configured limit after a successful flush/rotation cycle.
- [x] Rotation preserves the newest valid entries and handles malformed lines predictably.
- [x] Runtime changes to age, size, and backup settings affect subsequent writes.
- [x] Tests document purge-in-place behavior; archival generations remain a separate future decision.
