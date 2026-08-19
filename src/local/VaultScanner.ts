import { App, TFile } from "obsidian";
import type { FileEntity, SyncItSettings } from "../types";
import { createSyncitTempPath, isSyncitTempPath } from "../sync/AtomicWrite";
import { HiddenPathScanner } from "./HiddenPathScanner";

/**
 * Safety blocklist applied to ALL scanned files (both standard and hidden).
 */
const BLOCKLISTED_FILES = [
	"manifest.json",
	"data.json",
	"hot-reload.json",
];

const BLOCKLISTED_EXTS = [".js", ".css", ".mjs", ".tmp", ".bak"];

/**
 * Scans the local vault for files to sync.
 */
export class VaultScanner {
	constructor(
		private app: App,
		private settings: SyncItSettings,
	) {}

	/**
	 * Get all files that should be synced.
	 * Merges standard vault scan with hidden path scan.
	 */
	async scan(): Promise<FileEntity[]> {
		const standardFiles = await this.scanVaultRoot();

		if (!this.settings.includePatterns || this.settings.includePatterns.length === 0) {
			return standardFiles;
		}

		const hiddenFiles = await this.scanHiddenPaths();

		// Merge, avoiding duplicates (standard scan wins if same path)
		const seen = new Set(standardFiles.map((f) => f.path));
		const merged = [...standardFiles];

		for (const f of hiddenFiles) {
			if (!seen.has(f.path)) {
				merged.push(f);
			}
		}

		return merged;
	}

	/**
	 * Scan standard vault files via app.vault.getFiles().
	 */
	private async scanVaultRoot(): Promise<FileEntity[]> {
		const files = this.app.vault.getFiles();
		const result: FileEntity[] = [];

		for (const file of files) {
			if (isSyncitTempPath(file.path) || this.shouldExclude(file.path)) {
				continue;
			}
			if (this.isBlocklisted(file.path)) {
				console.warn(`[SyncIt] Blocked vault path: ${file.path}`);
				continue;
			}

			result.push({
				path: file.path,
				mtime: file.stat.mtime,
				size: file.stat.size,
			});
		}

		return result;
	}

	/**
	 * Scan hidden paths configured in includePatterns.
	 */
	private async scanHiddenPaths(): Promise<FileEntity[]> {
		const scanner = new HiddenPathScanner(this.app, this.settings.includePatterns);
		const files = await scanner.scan();

		// Also apply user excludePatterns as a secondary filter
		return files.filter((f) => !this.shouldExclude(f.path));
	}

	/**
	 * Check if a file path matches the safety blocklist.
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

		return false;
	}
	/**
	 * Check if a path should be excluded from sync.
	 * Include patterns act as exceptions to exclude patterns.
	 */
	shouldExclude(path: string): boolean {
		for (const pattern of this.settings.excludePatterns) {
			if (this.matchesPattern(path, pattern)) {
				// Include patterns are exceptions to exclude patterns
				if (this.isIncluded(path)) {
					return false;
				}
				return true;
			}
		}
		return false;
	}

	/**
	 * Check if a path matches any include pattern.
	 */
	private isIncluded(path: string): boolean {
		for (const pattern of this.settings.includePatterns) {
			if (this.matchesPattern(path, pattern)) {
				return true;
			}
		}
		return false;
	}

	/**
	 * Check if a path matches a given pattern.
	 */
	private matchesPattern(path: string, pattern: string): boolean {
		if (pattern.endsWith("/")) {
			// Directory pattern: match if path starts with this or is exactly the dir (without trailing /)
			if (path.startsWith(pattern) || path === pattern.slice(0, -1)) {
				return true;
			}
		} else {
			// File pattern: exact match or glob
			if (path === pattern || this.matchGlob(path, pattern)) {
				return true;
			}
		}
		return false;
	}

	/**
	 * Simple glob matching. Supports * wildcard.
	 */
	private matchGlob(path: string, pattern: string): boolean {
		const regex = new RegExp(
			"^" + pattern.replace(/\./g, "\\.").replace(/\*/g, ".*") + "$"
		);
		return regex.test(path);
	}

	/**
	 * Read the content of a local file.
	 */
	async readFile(path: string): Promise<string> {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) {
			throw new Error(`File not found: ${path}`);
		}
		return await this.app.vault.read(file);
	}

	/**
	 * Write content to a local file.
	 */
	async writeFile(path: string, content: string): Promise<void> {
		await this.ensureParentDirectory(path);
		const tempPath = createSyncitTempPath(path);

		try {
			await this.app.vault.adapter.write(tempPath, content);
			await this.app.vault.adapter.rename(tempPath, path);
		} catch (error) {
			await this.removeTempFile(tempPath);
			throw error;
		}
	}

	/** Remove temporary files left behind by an interrupted write. */
	async cleanupTempFiles(): Promise<number> {
		let removed = 0;
		for (const file of this.app.vault.getFiles()) {
			if (!isSyncitTempPath(file.path)) continue;
			await this.app.vault.adapter.remove(file.path);
			removed++;
		}
		return removed;
	}

	private async ensureParentDirectory(path: string): Promise<void> {
		const parts = path.split("/").slice(0, -1);
		let current = "";
		for (const part of parts) {
			current = current ? `${current}/${part}` : part;
			if (!(await this.app.vault.adapter.exists(current))) {
				await this.app.vault.adapter.mkdir(current);
			}
		}
	}

	private async removeTempFile(path: string): Promise<void> {
		try {
			await this.app.vault.adapter.remove(path);
		} catch {
			// Preserve the original error. A later startup cleanup can remove it.
		}
	}

	/**
	 * Delete a local file (to trash).
	 */
	async deleteFile(path: string): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (file instanceof TFile) {
			if (this.settings.moveToTrash) {
				await this.app.vault.trash(file, true); // system trash
			} else {
				await this.app.vault.delete(file);
			}
		}
	}
}
