# T5a: Structured Sync Error Reporting

*Created: 2026-09-01 22:45 IST*
*Last Updated: 2026-09-01 22:45 IST*

**Status**: 🔄 **PLANNED**
**Parent**: T5 (Sync History Log)
**Priority**: P0 (user-visible failure diagnosis)
**Dependencies**: T5, T12b

## Objective

Make every failed file operation visible in the persisted SyncIt log. A sync summary such as `errors: 272` must link to 272 inspectable error records.

## Scope

- Add a typed failure shape containing operation, path, phase, message, and safe details.
- Preserve compatibility for the existing `SyncResult` contract while migrating callers away from unstructured error strings where practical.
- Persist one `ERROR` entry per failed upload, download, conflict, local delete, or remote delete.
- Sanitize error text so credentials, authorization headers, and sensitive request payloads never enter the log.
- Correct live progress classification so failed operations display as Error rather than as successful operations.
- Keep the final sync summary with counts by operation and total failure count.

## Acceptance Criteria

- [ ] A failed operation produces one persisted `ERROR` JSONL entry.
- [ ] Each entry identifies the path and operation and contains a useful safe message.
- [ ] The sync summary count equals the number of persisted operation failures for that run.
- [ ] The sidebar activity feed labels failed operations as Error.
- [ ] Tests cover upload, download, conflict, local-delete, remote-delete, and cancellation behavior.
- [ ] Tests prove no credential or authorization data is logged.

## Related Files

- `src/sync/SyncPlan.ts`
- `src/main.ts`
- `src/logging/SyncLogger.ts`
- `src/ui/SyncSidebarView.ts`
- `tests/`
