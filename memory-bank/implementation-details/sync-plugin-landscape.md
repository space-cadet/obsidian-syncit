# Sync Plugin Landscape Analysis

*Created: 2026-08-17 12:55 IST*

## Remotely Save — Deep Dive

### Architecture
```
src/
  main.ts           — Plugin entry, settings, commands, status bar
  settings.ts       — Settings tab UI
  baseTypes.ts      — Core type definitions (Entity, MixedEntity, etc.)
  fsAll.ts          — Abstract FakeFs interface
  fsLocal.ts        — Local filesystem wrapper
  fsWebdav.ts       — WebDAV implementation (using webdav npm package)
  fsS3.ts           — S3 implementation
  fsDropbox.ts      — Dropbox OAuth + API
  ...               — Other backends
  sync/             — Pro version sync algorithm
  localdb.ts        — IndexedDB wrapper for metadata
  copyLogic.ts      — Sync decision engine
  encrypt*.ts       — Encryption layers
```

### Key Abstractions

**FakeFs** (from `fsAll.ts`):
```typescript
abstract class FakeFs {
  abstract walk(): Promise<Entity[]>;
  abstract walkPartial(): Promise<Entity[]>;
  abstract stat(key: string): Promise<Entity>;
  abstract mkdir(key: string): Promise<Entity>;
  abstract writeFile(key: string, content: ArrayBuffer): Promise<Entity>;
  abstract readFile(key: string): Promise<ArrayBuffer>;
  abstract rename(key1: string, key2: string): Promise<void>;
  abstract rm(key: string): Promise<void>;
  abstract checkConnect(): Promise<boolean>;
}
```

**Entity** (from `baseTypes.ts`):
```typescript
interface Entity {
  keyRaw: string;      // Path
  mtimeCli?: number;   // Client mtime
  mtimeSvr?: number;   // Server mtime
  sizeRaw: number;     // Size in bytes
  hash?: string;       // Content hash
  etag?: string;       // Server etag
}
```

### WebDAV Implementation Details

1. **Uses `webdav` npm package** — Full-featured WebDAV client
2. **Patches `request`** — Intercepts webdav lib's HTTP calls to use Obsidian's `requestUrl`
3. **Handles auth** — Basic and Digest auth types
4. **Chunked uploads** — Nextcloud (MKCOL + chunks + MOVE), Apache partial, SabreDAV partial
5. **Depth handling** — Manual BFS for depth=1, infinity PROPFIND when supported
6. **Path normalization** — Handles leading slashes, encodes URIs, strips parent references

### Sync Algorithm (from pro/src/sync.ts — not fully examined)

1. Walk local filesystem → get local entities
2. Walk remote filesystem → get remote entities
3. Compare by key, mtime, size
4. Build sync plan (upload/download/delete/conflict)
5. Execute plan with progress callbacks
6. Update local DB with sync state

## LiveSync — Overview

### Architecture
- **Backend**: CouchDB/PouchDB with replication
- **Real-time**: Continuous sync with change feed
- **Encryption**: End-to-end with passphrase
- **Conflict handling**: Document revisions, merge strategies
- **P2P**: Optional peer-to-peer sync without server

### Complexity Factors
- Needs CouchDB server setup
- Complex conflict resolution UI
- Chunked file storage (files split into chunks)
- Revision history tracking
- Custom sync protocol on top of CouchDB

## Lessons for Obsidian SyncIt

### What to borrow from Remotely Save
1. **FakeFs abstraction** — Clean separation of local/remote
2. **Entity model** — Path + mtime + size is sufficient for simple sync
3. **PROPFIND parsing** — Use Obsidian's requestUrl, not external HTTP libs
4. **Status bar pattern** — Show sync state, last sync time
5. **Settings UI** — Obsidian's SettingTab with sections

### What to simplify vs Remotely Save
1. **No local DB** — Obsidian's file metadata is sufficient
2. **No encryption layer** — HTTPS + optional obsidian-secrets integration
3. **No chunked uploads** — v1: files < 10MB only, or simple PUT
4. **No auto-sync** — Manual trigger only in v1
5. **No conflict UI** — Timestamp wins, log conflicts
6. **Single backend** — WebDAV only

### What to avoid from LiveSync
1. **No CouchDB dependency** — Too complex for users
2. **No real-time sync** — Manual is simpler and safer
3. **No chunking** — Keep files whole

## Recommended Architecture for SyncIt

```
src/
  main.ts              — Plugin class, commands, status bar
  settings.ts          — Settings tab
  types.ts             — Core types (SyncItSettings, Entity, etc.)
  sync/
    VaultSyncEngine.ts — Main sync orchestrator
    SyncPlan.ts        — Build and execute sync plans
  remote/
    WebDAVAdapter.ts   — WebDAV operations (adapted from obsidian-ai)
  local/
    VaultScanner.ts    — Scan local vault for files
  ui/
    SyncModal.ts       — Progress modal
```

## MVP Scope

### Phase 1: Basic Sync (Week 1)
- WebDAV connection settings
- Manual sync button (ribbon + command)
- Upload changed files (local newer → remote)
- Download changed files (remote newer → local)
- Simple progress indication
- Status bar: last sync time

### Phase 2: Bidirectional + Safety (Week 2)
- Delete handling (move to .trash/ instead of permanent delete)
- Exclude patterns (.obsidian/, .git/, attachments)
- Conflict detection (both changed) — keep newer, log warning
- Connection test button

### Phase 3: Polish (Week 3)
- Settings UI with validation
- Better error messages
- Dry-run mode (preview changes)
- Integration with obsidian-ai provider API
