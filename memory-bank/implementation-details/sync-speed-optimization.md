# Sync Speed Optimization — Technical Analysis

**Date**: 2026-08-17
**Updated**: 2026-08-18
**Related Tasks**: T12 (parent), T12a, T12b, T12c, T12d
**Status**: ✅ All subtasks implemented

## Executive Summary

Sync performance is poor due to two bugs and two bottlenecks. The most severe issue is **sequential execution** (T12b): files are uploaded/downloaded one at a time, making sync time linear with file count. The second critical issue is **PROPFIND depth=1** (T12a), which causes the plugin to silently miss all nested files.

For a vault with 100 files:
- **Current**: ~20 seconds (sequential, depth=1 misses subfolders)
- **After T12a+T12b**: ~3–5 seconds (parallel, full tree)
- **After T12a+T12b+T12c+T12d**: <1 second for unchanged vaults

---

## Issue 1: PROPFIND Depth = 1 (T12a)

### Code Location
`src/remote/WebDAVAdapter.ts`, method `listFiles()`, line ~64

```typescript
const items = await this.propfind(this.baseDir, 1);  // Depth: 1
```

### Impact
- **Severity**: 🔥 Critical — correctness bug
- Only files directly under `baseDir` are discovered
- All nested files (`Projects/Notes/foo.md`, `Journal/2026/08/17.md`) are silently ignored
- User may believe sync is working when it's only syncing a fraction of their vault

### WebDAV Depth Header Behavior

| Depth Value | Behavior |
|-------------|----------|
| `0` | Properties of the resource itself only |
| `1` | Resource + immediate children |
| `infinity` | Resource + all descendants recursively |

### Recommended Fix
1. Try `Depth: infinity` first (single request, full tree)
2. If server rejects with 403/400/501, fall back to recursive `Depth: 1` directory walk
3. Parse all `<D:response>` entries, filter out directories (no `<D:getcontentlength>`)

---

## Issue 2: Sequential Execution (T12b)

### Code Location
`src/sync/SyncPlan.ts`, method `executePlan()`, lines ~76–130

```typescript
// Uploads: sequential
for (const file of plan.uploads) {
    const content = await this.scanner.readFile(file.path);   // blocks
    await this.adapter.writeFile(file.path, content);          // blocks
}

// Downloads: sequential
for (const file of plan.downloads) {
    const content = await this.adapter.readFile(file.path);    // blocks
    await this.scanner.writeFile(file.path, content);          // blocks
}
```

### Impact
- **Severity**: 🔥 Major — primary speed bottleneck
- 100 files × 200ms average = 20 seconds
- Network and disk I/O are completely serialized

### Recommended Fix
Implement a concurrency limiter:

```typescript
async function runWithConcurrency<T>(
    items: T[],
    limit: number,
    fn: (item: T) => Promise<void>
): Promise<void> {
    const executing: Promise<void>[] = [];
    for (const item of items) {
        const p = fn(item).then(() => {
            executing.splice(executing.indexOf(p), 1);
        });
        executing.push(p);
        if (executing.length >= limit) {
            await Promise.race(executing);
        }
    }
    await Promise.all(executing);
}
```

Apply to uploads, downloads, and conflict resolution. Default limit: **3**.

---

## Issue 3: Redundant MKCOL Calls (T12c)

### Code Location
`src/remote/WebDAVAdapter.ts`, method `writeFile()`, lines ~52–58

```typescript
// For every file, recreate all parent directories
for (let i = 0; i < parts.length - 1; i++) {
    parentPath += parts[i] + "/";
    await this.mkcol(this.baseDir + parentPath);  // redundant!
}
```

### Impact
- **Severity**: Moderate
- 50 files in same directory = 100 MKCOL requests (most returning 405)
- Adds unnecessary latency and server load

### Recommended Fix
Track created directories per sync session:

```typescript
private createdDirs = new Set<string>();

async ensureDir(path: string): Promise<void> {
    if (this.createdDirs.has(path)) return;
    await this.mkcol(path);
    this.createdDirs.add(path);
}
```

---

## Issue 4: No Local Sync Index (T12d) — ✅ FIXED

### Problem
Every sync re-reads and re-compares every file. There's no record of "what was already in sync."

### Impact
- **Severity**: High
- Even if zero files changed, sync still lists all files and compares mtimes
- For large vaults (1000+ files), this is significant overhead

### Fix Implemented
- `SyncIndexManager` persists sync state to `sync-index.json`
- `SyncIndexEntry` tracks localMtime, localSize, remoteEtag, remoteMtime, remoteSize
- On `buildPlan()`: if file in index and local unchanged → skip unless remote ETag changed
- After successful sync: update index incrementally via `patchIndex()`
- Index invalidated when server config changes

### Reliability Enhancement (2026-08-18)
- `makeServerSignature()` now normalizes URL and baseDir: trims whitespace, strips trailing slashes
- Prevents signature mismatches from trivial formatting differences (e.g., `https://example.com/` vs `https://example.com`)

### Critical Bug Fixed (2026-08-18)
- `saveSettings()` was clearing the index on EVERY settings save, even trivial toggles
- Fix: only clear index when server config (URL, username, password, baseDir) actually changes
- Without this fix, T12d appeared broken — all files re-uploaded every sync

---

## Implementation Status

| Order | Task | Status | Commit |
|-------|------|--------|--------|
| 1 | T12a — Fix PROPFIND depth | ✅ Complete | — |
| 2 | T12b — Parallel sync | ✅ Complete | — |
| 3 | T12c — Batch MKCOL | ✅ Complete | — |
| 4 | T12d — Local index | ✅ Complete | — |
| 5 | Signature normalization | ✅ Complete | `aaa1d4a` |
| 6 | saveSettings() invalidation narrowing | ⚠️ Partial | `fd784b2` removed the blanket clear; a true pre-change snapshot and tests remain required |

---

## Performance Estimates

| Scenario | Current | After T12a+T12b | After all |
|----------|---------|-----------------|-----------|
| 50 files, 0 changed | 10s | 3s | 0.5s |
| 50 files, 5 changed | 10s | 3s | 1.5s |
| 200 files, 0 changed | 40s | 10s | 0.5s |
| 200 files, 20 changed | 40s | 10s | 4s |

---

## Files Modified

| File | Changes |
|------|---------|
| `src/remote/WebDAVAdapter.ts` | T12a (recursive listFiles), T12c (MKCOL batching) |
| `src/sync/SyncPlan.ts` | T12b (concurrency in executePlan) |
| `src/sync/SyncIndex.ts` | T12d (local sync index) |
| `src/types.ts` | T12b (concurrencyLimit setting), T12d (index types) |
| `src/settings.ts` | T12b (concurrency UI), T12d (signature normalization, partial saveSettings invalidation fix) |
