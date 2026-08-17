import { App, TFile } from "obsidian";
import type { FileEntity, SyncItSettings } from "../types";

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
	 */
	async scan(): Promise<FileEntity[]> {
		const files = this.app.vault.getFiles();
		const result: FileEntity[] = [];

		for (const file of files) {
			if (this.shouldExclude(file.path)) {
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
	 * Check if a path should be excluded from sync.
	 */
	shouldExclude(path: string): boolean {
		for (const pattern of this.settings.excludePatterns) {
			if (pattern.endsWith("/")) {
				// Directory pattern: exclude if path starts with this
				if (path.startsWith(pattern) || path === pattern.slice(0, -1)) {
					return true;
				}
			} else {
				// File pattern: exact match or glob
				if (path === pattern || this.matchGlob(path, pattern)) {
					return true;
				}
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
		const file = this.app.vault.getAbstractFileByPath(path);
		if (file instanceof TFile) {
			await this.app.vault.modify(file, content);
		} else {
			// Create new file
			const dir = path.split("/").slice(0, -1).join("/");
			if (dir) {
				const dirExists = await this.app.vault.adapter.exists(dir);
				if (!dirExists) {
					await this.app.vault.createFolder(dir);
				}
			}
			await this.app.vault.create(path, content);
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
