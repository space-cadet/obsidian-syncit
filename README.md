# Obsidian SyncIt

Lightweight WebDAV vault sync for Obsidian. Part of the [Space Cadet](https://github.com/space-cadet) plugin ecosystem.

[![Build](https://github.com/space-cadet/obsidian-syncit/actions/workflows/build.yml/badge.svg)](https://github.com/space-cadet/obsidian-syncit/actions/workflows/build.yml)

## Features

- 🔄 **Bidirectional sync** — Keep your vault in sync across devices via WebDAV
- 🖱️ **Manual sync** — You control when sync happens
- 🔒 **HTTPS only** — Secure by default
- ⚡ **Fast** — Only syncs changed files using timestamp comparison
- 🗑️ **Safe deletes** — Moves deleted files to trash, never permanent deletion
- 🎯 **Focused** — WebDAV only, no bloat
- 📦 **Auto-updater** — Built-in update checker with stable/dev channels

## Installation

### From Obsidian Community Plugins

1. Open Settings → Community Plugins
2. Turn off Safe Mode
3. Click Browse and search for "SyncIt"
4. Click Install, then Enable

### Manual Installation

1. Download the latest release from [GitHub Releases](https://github.com/space-cadet/obsidian-syncit/releases)
2. Extract to `.obsidian/plugins/obsidian-syncit/`
3. Enable in Obsidian Settings → Community Plugins

## Setup

1. Open SyncIt settings
2. Enter your WebDAV server URL (e.g., `https://nextcloud.example.com/remote.php/dav/files/username/`)
3. Enter username and password
4. Click "Test Connection"
5. Click "Sync Now" to start

### Supported WebDAV Servers

- [Nextcloud](https://nextcloud.com/)
- [ownCloud](https://owncloud.com/)
- [Nutstore (坚果云)](https://www.jianguoyun.com/)
- Any standard WebDAV server

## Ecosystem

SyncIt is part of a family of plugins:

| Plugin | Purpose |
|--------|---------|
| [obsidian-ai](https://github.com/space-cadet/obsidian-ai) | AI chat assistant |
| [obsidian-git-sync](https://github.com/space-cadet/obsidian-git) | Git-based sync |
| [obsidian-secrets](https://github.com/space-cadet/obsidian-secrets) | Note encryption |
| **obsidian-syncit** | **WebDAV sync** |

## Development

```bash
# Install dependencies
pnpm install

# Build for development
pnpm run dev

# Build for production
pnpm run build

# Run tests
pnpm run test
```

## License

GPL-3.0
