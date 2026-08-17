# Sync Speed Optimization — Technical Analysis

**Date**: 2026-08-17
**Related Tasks**: T12 (parent), T12a, T12b, T12c, T12d
**Status**: Analysis complete, implementation pending

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

## Issue 4: No Local Sync Index (T12d)

### Problem
Every sync re-reads and re-compares every file. There's no record of "what was already in sync."

### Impact
- **Severity**: High
- Even if zero files changed, sync still lists all files and compares mtimes
- For large vaults (1000+ files), this is significant overhead

### Recommended Fix
Store a local index at `sync-index.json`:

```typescript
interface SyncIndexEntry {
    localMtime: number;
    remoteMtime: number;
    localSize: number;
    remoteSize: number;
    etag?: string;
}
```

On `buildPlan()`:
- If file in index and local mtime/size unchanged → skip unless remote ETag changed
- After successful sync → update index

### Dependencies
- T4 (ETag support) provides the most reliable remote change detection
- Can implement with mtime fallback if T4 not yet done

---

## Implementation Priority

| Order | Task | Rationale |
|-------|------|-----------|
| 1 | T12a — Fix PROPFIND depth | Correctness must come before performance |
| 2 | T12b — Parallel sync | Biggest speed win |
| 3 | T12c — Batch MKCOL | Easy win, low risk |
| 4 | T12d — Local index | Requires T4 (ETags) for full benefit |

T12a and T12b can be done in parallel (they touch different files). T12c is a small WebDAVAdapter change. T12d should wait for T4 or use mtime-only fallback.

---

## Performance Estimates

| Scenario | Current | After T12a+T12b | After all |
|----------|---------|-----------------|-----------|
| 50 files, 0 changed | 10s | 3s | 0.5s |
| 50 files, 5 changed | 10s | 3s | 1.5s |
| 200 files, 0 changed | 40s | 10s | 0.5s |
| 200 files, 20 changed | 40s | 10s | 4s |

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/remote/WebDAVAdapter.ts` | T12a (recursive listFiles), T12c (MKCOL batching) |
| `src/sync/SyncPlan.ts` | T12b (concurrency in executePlan) |
| `src/sync/SyncIndex.ts` | T12d (new file) |
| `src/types.ts` | T12b (concurrencyLimit setting), T12d (index types) |
| `src/settings.ts` | T12b (concurrency UI) |
