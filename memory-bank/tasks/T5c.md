# T5c: Bounded Log Data Access

*Created: 2026-09-01 22:45 IST*
*Last Updated: 2026-09-01 23:26 IST*

**Status**: ✅ **IMPLEMENTED — manual Obsidian acceptance remains with T16d**
**Parent**: T5 (Sync History Log)
**Priority**: P1
**Dependencies**: T5, T5a, T5b

## Objective

Provide a stable data-access contract for a real log viewer without loading an unbounded JSONL file into the DOM.

## Scope

- Support level, category, search, session, and time-range filters.
- Support newest-first pagination or an explicit load-more cursor.
- Preserve stable ordering when new entries arrive during auto-refresh.
- Expose counts for total entries, errors, warnings, and the current result set.
- Return structured details for expandable inspection without mixing presentation markup into the logger.

## Acceptance Criteria

- [x] The viewer can load the latest page and older pages deterministically.
- [x] `All` returns all levels, while individual level filters select the requested level.
- [x] Hundreds or thousands of entries do not freeze the sidebar or modal because rendering is page-bounded.
- [x] Auto-refresh preserves the active filter and restores the current list scroll position.
- [x] Tests cover filtering, pagination, malformed lines, and concurrent-safe flush/read behavior.
