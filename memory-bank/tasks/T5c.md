# T5c: Bounded Log Data Access

*Created: 2026-09-01 22:45 IST*
*Last Updated: 2026-09-01 22:45 IST*

**Status**: 🔄 **PLANNED**
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

- [ ] The viewer can load the latest page and older pages deterministically.
- [ ] `All` returns all levels, while individual level filters have documented semantics.
- [ ] Hundreds or thousands of entries do not freeze the sidebar or modal.
- [ ] Auto-refresh does not reset the user’s current filter or scroll position unexpectedly.
- [ ] Tests cover filtering, pagination, malformed lines, and concurrent flush/read behavior.
