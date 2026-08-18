# Tech Context — Obsidian SyncIt

*Created: 2026-08-17 12:55 IST*
*Last Updated: 2026-08-18 11:45 IST*

## Stack

| Layer | Technology |
|-------|------------|
| Language | TypeScript |
| Build | esbuild (following obsidian-ai pattern) |
| Package Manager | pnpm |
| Testing | vitest |
| Linting | prettier |

## Dependencies

### Runtime
- `obsidian` — Obsidian API types
- No external HTTP libraries — use Obsidian's `requestUrl`

### Dev
- `typescript` — TypeScript compiler
- `esbuild` — Bundler
- `obsidian` — Type definitions
- `vitest` — Test runner
- `prettier` — Formatting

## Build Configuration

Following obsidian-ai's proven pattern:
- `esbuild.config.mjs` — Development + production builds
- `tsconfig.json` — Strict TypeScript
- `manifest.json` — Plugin manifest

## Project Structure

```
obsidian-syncit/
├── manifest.json
├── package.json
├── tsconfig.json
├── esbuild.config.mjs
├── version-bump.mjs
├── .gitignore
├── README.md
├── styles.css
├── src/
│   ├── main.ts
│   ├── settings.ts
│   ├── types.ts
│   ├── sync/
│   │   ├── VaultSyncEngine.ts
│   │   ├── SyncPlan.ts
│   │   ├── SyncIndex.ts          ← T12d: local sync index
│   │   └── DebugLogger.ts        ← T8: debug log file writer
│   ├── remote/
│   │   └── WebDAVAdapter.ts
│   ├── local/
│   │   └── VaultScanner.ts
│   └── ui/
│       ├── SyncProgressModal.ts
│       └── SyncSidebarView.ts
├── tests/
│   └── (vitest tests)
└── memory-bank/
    └── (project documentation)
```

## Key Type Definitions

```typescript
// types.ts
interface SyncItSettings {
  webdavUrl: string;
  webdavUsername: string;
  webdavPassword: string;
  remoteBaseDir: string;
  excludePatterns: string[];
  syncOnStartup: boolean;
  confirmBeforeDelete: boolean;
  concurrencyLimit: number;       // T12b: parallel sync limit (1–10)
}

interface FileEntity {
  path: string;
  mtime: number;
  size: number;
  etag?: string;                  // T4: ETag from WebDAV server
}

interface SyncPlan {
  uploads: FileEntity[];
  downloads: FileEntity[];
  deletes: FileEntity[];
  conflicts: Array<{ local: FileEntity; remote: FileEntity }>;
  unchanged: number;              // T12d: count of skipped files
}

interface SyncResult {
  uploaded: number;
  downloaded: number;
  deleted: number;
  conflicts: number;
  unchanged: number;              // T12d
  skipped: number;
  errors: string[];
  bytesUploaded: number;          // Multi-pass: byte-level progress
  bytesDownloaded: number;
  durationMs: number;
}

interface SyncIndexEntry {
  path: string;
  localMtime: number;
  localSize: number;
  remoteEtag: string;
  remoteMtime: number;
  remoteSize: number;
}

interface SyncIndex {
  version: number;
  serverSignature: string;        // hash of URL+username+baseDir
  entries: SyncIndexEntry[];
}
```

## Obsidian API Patterns

### File Operations
```typescript
// Reading file list
const files = app.vault.getFiles();

// Reading file content
const content = await app.vault.read(file);

// Writing file
await app.vault.modify(file, content);

// Creating file
await app.vault.create(path, content);

// Deleting file (to trash)
await app.vault.trash(file, true); // true = system trash
```

### HTTP Requests
```typescript
import { requestUrl } from 'obsidian';

const response = await requestUrl({
  url: 'https://example.com/dav/',
  method: 'PROPFIND',
  headers: {
    'Authorization': 'Basic ' + btoa(username + ':' + password),
    'Depth': '1',
  },
  body: propfindXml,
});
```

## WebDAV Operations Needed

| Operation | Method | Purpose |
|-----------|--------|---------|
| List directory | PROPFIND | Get remote file list |
| Read file | GET | Download file |
| Write file | PUT | Upload file |
| Create directory | MKCOL | Ensure remote path exists |
| Delete | DELETE | Remove remote file |

## Testing Strategy

1. **Unit tests** — Mock Obsidian API, test sync logic
2. **Integration tests** — Test against local WebDAV server (e.g., `wsgidav`)
3. **Manual tests** — Real Nextcloud/ownCloud instances

## Known Gotchas

1. **CORS** — Obsidian mobile may have CORS issues; `requestUrl` handles some but not all
2. **Auth encoding** — Non-ASCII passwords need UTF-8 → base64 encoding
3. **Path normalization** — WebDAV servers vary in trailing slash behavior
4. **Mobile filesystem** — `FileSystemAdapter` vs mobile adapter differences
5. **Large files** — Mobile memory limits; consider streaming for >10MB
6. **`.obsidian/` folder sync** — `app.vault.getFiles()` excludes dot folders by design. Would require rewriting VaultScanner to use `app.vault.adapter.list()` (obsidian-ai pattern). Deferred.
7. **saveSettings() index clearing** — Clearing sync index on every settings save (even trivial toggles) caused full re-uploads. The blanket clear was removed, but the current implementation still needs a true pre-change settings snapshot because settings controls mutate the shared object before `saveSettings()` runs.
8. **Signature normalization** — `makeServerSignature()` must trim whitespace and strip trailing slashes from URL/baseDir to prevent signature mismatches from trivial formatting differences.

## Planned T13 Safety Architecture

The local `sync-index.json` is a performance cache only. It cannot resolve first-sync ambiguity on a new device. T13 adds a versioned remote `.syncit/manifest.json` with content hashes, ETags, last-known paths, and deletion tombstones. The manifest is the shared baseline; the local index is rebuilt only after a complete verified run.

Planned settings include `syncDirection` (`two-way`, `download-only`, `upload-only`), `initialSyncPolicy` (`prompt`, `remote-wins`, `local-wins`, `review`), `conflictPolicy`, and `deletePolicy` (`trash`, `permanent`, `ignore`). These policies must be separate: an ongoing two-way mode does not make a first sync safe.

T13 also coordinates T4 conflict handling, T5 reconciliation history, T6 folder-scoped decisions, T9 atomic writes, and T10 reversible trash/snapshot behavior. Binary-safe file operations and encoded WebDAV path segments are required before claiming full vault support.
