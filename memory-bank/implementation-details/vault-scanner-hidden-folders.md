# VaultScanner Hidden Folder Access Design

*Created: 2026-08-19*
*Related Task: T15*

## Problem

SyncIt's `VaultScanner` uses `app.vault.getFiles()` which returns only Obsidian-tracked files. The `.obsidian/` directory is excluded by default via `excludePatterns`. This prevents SyncIt from syncing data stored inside `.obsidian/` — most notably obsidian-ai's chat sessions at `.obsidian/plugins/obsidian-ai/sessions/`.

## Solution Overview

Two-part scanner:
1. **Standard scanner** (existing): Uses `getFiles()` for vault root
2. **Hidden path scanner** (new): Uses `adapter.list()` for whitelisted hidden paths

## Architecture

```
VaultScanner.scan()
├── scanVaultRoot()     → app.vault.getFiles() [existing]
└── scanHiddenPaths()   → app.vault.adapter.list() [new]
    └── for each includePattern:
        ├── adapter.list(pattern)
        ├── filter: safety blocklist
        └── filter: excludePatterns (still apply)
```

## Safety Model

### Include Patterns
```typescript
includePatterns: [
    ".obsidian/plugins/obsidian-ai/sessions/"
]
```

An include pattern is an **exception** to an exclude pattern. Evaluation order:
1. If path matches any `excludePatterns` → excluded (default)
2. If path matches any `includePatterns` → included (exception)
3. Otherwise → included

### Hardcoded Blocklist

Even if included, these file types are NEVER synced:

| Pattern | Reason |
|---------|--------|
| `*.js` | Plugin code |
| `*.css` | Plugin styles |
| `manifest.json` | Plugin metadata |
| `data.json` | Plugin settings |
| `*.tmp` | Temporary files |
| `*.bak` | Backups |

### Path Validation

Include paths must:
- Start with `.obsidian/` (no vault root includes for now)
- Not contain `../` (path traversal)
- Be a directory path (end with `/`)

## Implementation

### New Types

```typescript
// Add to SyncItSettings
includePatterns: string[];  // Default: []

// Add to types
interface HiddenPathConfig {
    path: string;       // e.g., ".obsidian/plugins/obsidian-ai/sessions/"
    enabled: boolean;   // Can toggle without deleting config
}
```

### VaultScanner Changes

```typescript
class VaultScanner {
    async scan(): Promise<FileEntity[]> {
        const standardFiles = await this.scanVaultRoot();
        const hiddenFiles = await this.scanHiddenPaths();
        return [...standardFiles, ...hiddenFiles];
    }

    private async scanHiddenPaths(): Promise<FileEntity[]> {
        const results: FileEntity[] = [];
        
        for (const pattern of this.settings.includePatterns) {
            if (!pattern.endsWith('/')) continue; // Directories only
            
            const entries = await this.listHiddenPath(pattern);
            for (const entry of entries) {
                if (this.isBlocklisted(entry.path)) continue;
                if (this.shouldExclude(entry.path)) continue;
                results.push(entry);
            }
        }
        
        return results;
    }

    private async listHiddenPath(path: string): Promise<FileEntity[]> {
        const adapter = this.app.vault.adapter;
        const listing = await adapter.list(path);
        
        // Convert listing to FileEntity[]
        // Handle both files and recursive directories
        // ...
    }
}
```

### Settings UI

Add to Settings UI:
- Text area for include patterns (one per line)
- Warning when adding `.obsidian/` without subdirectory
- Visual indicator for blocklisted files in dry-run

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| User includes entire `.obsidian/` | UI warning + validation rejects bare `.obsidian/` |
| Plugin code gets synced | Hardcoded blocklist for `.js`, `.css`, etc. |
| Settings overwritten cross-device | Blocklist includes `data.json` |
| Performance on large hidden dirs | Only list whitelisted paths, not recursive `.obsidian/` scan |

## Future Extensions

- Per-include sync direction (e.g., hidden paths upload-only)
- Include pattern templates ("obsidian-ai sessions", "custom CSS snippets")
- Integration with obsidian-ai: auto-detect session folder and suggest include

## Related Files

- `src/local/VaultScanner.ts` — Main scanner
- `src/types.ts` — Settings types
- `src/sync/SyncPlan.ts` — Plan building
- `src/settings.ts` — UI
