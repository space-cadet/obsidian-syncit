import { App } from "obsidian";
import type { FileEntity } from "../types";

/**
 * Hardcoded safety blocklist — these files are NEVER synced,
 * even if explicitly included via includePatterns.
 */
const BLOCKLISTED_FILES = [
	"manifest.json",
	"data.json",
	"hot-reload.json",
];

const BLOCKLISTED_EXTS = [".js", ".css", ".mjs", ".tmp", ".bak"];

/**
 * Core Obsidian settings files that should never be synced.
 * These are matched by exact path under .obsidian/.
 */
const BLOCKLISTED_CORE_SETTINGS = [
	".obsidian/app.json",
	".obsidian/appearance.json",
	".obsidian/workspace.json",
];

/**
 * Scans hidden/dot folders under .obsidian/ that Obsidian does not
 * track via app.vault.getFiles().
 */
export class HiddenPathScanner {
	constructor(
		private app: App,
		private includePatterns: string[],
	) {}

	/**
	 * Scan all configured includePatterns and return FileEntity[] for
	 * every file found inside them.  Directories are traversed recursively.
	 */
	async scan(): Promise<FileEntity[]> {
		const results: FileEntity[] = [];

		for (const pattern of this.includePatterns) {
			const trimmed = pattern.trim();
			if (!trimmed) continue;

			const validationError = this.validatePattern(trimmed);
			if (validationError) {
				console.warn(`[SyncIt] Skipping invalid include pattern "${trimmed}": ${validationError}`);
				continue;
			}

			const files = await this.listRecursive(trimmed);
			for (const f of files) {
				if (this.isBlocklisted(f.path)) {
					console.warn(`[SyncIt] Blocked hidden path: ${f.path}`);
					continue;
				}
				results.push(f);
			}
		}

		return results;
	}

	/**
	 * Validate an include pattern.
	 * Returns an error string or undefined if valid.
	 */
	validatePattern(pattern: string): string | undefined {
		if (pattern.includes("..")) {
			return "Path traversal (../) is not allowed";
		}
		if (!pattern.startsWith(".obsidian/")) {
			return "Include paths must be under .obsidian/";
		}
		if (pattern === ".obsidian/" || pattern === ".obsidian") {
			return "Including the entire .obsidian/ folder is not allowed for safety";
		}
		// Must end with / to indicate a directory
		if (!pattern.endsWith("/")) {
			return "Include path must be a directory (end with /)";
		}
		return undefined;
	}

	/**
	 * Check whether a file path is on the hardcoded safety blocklist.
	 */
	isBlocklisted(path: string): boolean {
		const basename = path.split("/").pop() || "";

		if (BLOCKLISTED_FILES.includes(basename)) {
			return true;
		}

		for (const ext of BLOCKLISTED_EXTS) {
			if (basename.endsWith(ext)) {
				return true;
			}
		}

		// Block any file directly inside .obsidian/plugins/<plugin-id>/
		// Subdirectories (e.g., .obsidian/plugins/foo/sessions/) are allowed
		if (/^\.obsidian\/plugins\/[^/]+\/[^/]+$/.test(path)) {
			return true;
		}

		if (BLOCKLISTED_CORE_SETTINGS.includes(path)) {
			return true;
		}

		return false;
	}

	/**
	 * Recursively list all files under a given path using the vault adapter.
	 */
	private async listRecursive(dirPath: string): Promise<FileEntity[]> {
		const results: FileEntity[] = [];
		const adapter = this.app.vault.adapter;

		try {
			const listing = await adapter.list(dirPath);

			// Files in this directory
			for (const filePath of listing.files) {
				const stat = await adapter.stat(filePath);
				if (stat && stat.type === "file") {
					results.push({
						path: filePath,
						mtime: stat.mtime,
						size: stat.size,
					});
				}
			}

			// Recurse into subdirectories
			for (const subdir of listing.folders) {
				// Avoid infinite loops from symlinks — keep paths normalized
				if (subdir === dirPath || subdir.startsWith(dirPath + "/" + ".")) {
					continue;
				}
				const subFiles = await this.listRecursive(subdir);
				results.push(...subFiles);
			}
		} catch (err) {
			console.warn(`[SyncIt] Failed to list hidden path "${dirPath}":`, err);
		}

		return results;
	}
}
