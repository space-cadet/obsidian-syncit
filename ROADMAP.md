# Obsidian SyncIt — Feature Roadmap

*Consolidated from dual review (2026-08-17)*
*Status: v0.1.0 MVP shipped, iterating toward v1.0*

---

## Philosophy

Focused tool, not a kitchen sink. Part of the Space Cadet ecosystem:
- **obsidian-secrets** → Encryption (not our job)
- **obsidian-git-sync** → Git-based sync (different use case)
- **obsidian-syncit** → WebDAV sync (our job — do it well)

**Rule:** If another plugin in the ecosystem does it, we integrate with it, we don't duplicate it.

---

## v0.2.0 — The Safe Bundle (Next Release)

> *"Auto-sync without trash-mode deletes is a foot-gun."*

| # | Feature | Effort | Why P0 |
|---|---------|--------|--------|
| 1 | **Trash-mode deletes** | Low | Prevents data loss — remote deletions go to `.syncit-trash/`, local deletions use Obsidian's system trash |
| 2 | **Auto-sync** | Medium | File watcher (30s debounce) + periodic (15min) + on-focus + on-startup |
| 3 | **Pre-sync snapshot** | Medium | Copy files before modifying; keep last 10 snapshots; one-click restore |

**Trash-mode specifics:**
- Deleted locally → move to `.syncit-trash/` on remote (not permanent delete)
- Deleted remotely → move to local `.trash/` (Obsidian's system trash)
- Configurable: "trash" (default) vs "permanent" vs "ignore deletes"

**Auto-sync specifics:**
- File watcher: `vault.on("modify")` with 30s debounce
- Periodic: Every N minutes (configurable)
- On focus: When window regains focus
- On startup: Delayed 10s
- Respect offline state — queue, don't fail

---

## v0.3.0 — Conflict Resolution

| # | Feature | Effort |
|---|---------|--------|
| 4 | **Conflict detection** | Low |
| 5 | **Conflict resolution UI** | Medium |

**Behavior:**
- Detect when both sides changed since last sync
- Modal showing: local content, remote content, diff
- Options: keep local, keep remote, keep both (auto-rename), skip
- Default: prompt user (not silent)

---

## v1.0 — Production Ready

| # | Feature | Effort | Notes |
|---|---------|--------|-------|
| 6 | **Selective folder sync** | Low | Pick folders to include/exclude per sync profile |
| 7 | **Filename normalization** | Low | Windows-forbidden chars, path length, case-sensitivity |
| 8 | **Atomic writes** | Low | Write to `.tmp`, rename on success |
| 9 | **Offline queue** | Medium | Queue changes when offline, reconcile on reconnect |
| 10 | **Sync history log** | Low | Persistent log of all sync operations |

---

## Post-v1.0 (Nice to Have)

| # | Feature | Effort | Notes |
|---|---------|--------|-------|
| 11 | **File explorer indicators** | High | Status dots in file tree (requires monkey-patching) |
| 12 | **Dry-run mode** | Low | Preview changes without applying |
| 13 | **Mobile data / WiFi toggle** | Low | Don't sync on cellular |
| 14 | **Bandwidth throttling** | Medium | Limit upload/download speed |
| 15 | **Chunked uploads for large files** | Medium | Resume on failure |
| 16 | **Per-file "sync now / ignore"** | Low | Context menu items |

---

## Deliberately Out of Scope

| Feature | Reason |
|---------|--------|
| End-to-end encryption | Use **obsidian-secrets** |
| Multiple storage backends (S3, Dropbox, etc.) | WebDAV-only by design |
| Multi-vault profiles | One plugin instance per vault |
| Real-time collaboration | Different problem space |
| Git integration | Use **obsidian-git-sync** |

---

## Current Status

| Version | Status | Features |
|---------|--------|----------|
| v0.1.0 | ✅ Shipped | Manual sync, WebDAV adapter, progress modal, sidebar, auto-updater |
| v0.2.0 | 🔄 Next | Trash-mode deletes + auto-sync + snapshots |
| v0.3.0 | 📋 Planned | Conflict resolution UI |
| v1.0 | 🎯 Target | Production-ready with offline queue, selective sync, atomic writes |
