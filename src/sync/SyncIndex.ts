import type { FileEntity, SyncIndex, SyncIndexEntry } from "../types";

const INDEX_FILENAME = "sync-index.json";

/** Minimal file-system interface for index persistence. */
export interface IndexStorage {
	exists(path: string): Promise<boolean>;
	read(path: string): Promise<string>;
	write(path: string, data: string): Promise<void>;
	remove(path: string): Promise<void>;
}

/**
 * Manages the local sync index — a persisted cache of file state from the last
 * successful sync. Used to skip unchanged files and avoid redundant network
 * round-trips.
 *
 * T12d: Local Sync Index — Skip Unchanged Files
 */
export class SyncIndexManager {
	private index: SyncIndex | null = null;
	private dataDir: string;
	private storage: IndexStorage;

	constructor(dataDir: string, storage: IndexStorage) {
		this.dataDir = dataDir;
		this.storage = storage;
	}

	/**
	 * Generate a server signature from connection config.
	 * If the signature changes, the index is invalidated.
	 *
	 * Normalizes inputs to avoid signature mismatches from trivial
	 * formatting differences (trailing slashes, whitespace).
	 */
	static makeServerSignature(config: {
		url: string;
		username: string;
		baseDir: string;
	}): string {
		const url = config.url.trim().replace(/\/$/, "");
		const username = config.username.trim();
		const baseDir = config.baseDir.trim().replace(/^\//, "").replace(/\/$/, "");
		const raw = `${url}|${username}|${baseDir}`;
		let hash = 0;
		for (let i = 0; i < raw.length; i++) {
			const char = raw.charCodeAt(i);
			hash = (hash << 5) - hash + char;
			hash |= 0;
		}
		return String(hash);
	}

	/**
	 * Load the index from disk. Returns null if missing, corrupted,
	 * or server signature mismatch.
	 */
	async load(expectedSignature: string): Promise<SyncIndex | null> {
		if (this.index) return this.index;

		try {
			const path = `${this.dataDir}/${INDEX_FILENAME}`;
			const exists = await this.storage.exists(path);
			if (!exists) return null;

			const data = await this.storage.read(path);
			const parsed: SyncIndex = JSON.parse(data);

			if (parsed.serverSignature !== expectedSignature) {
				console.info("SyncIt: Server signature changed, invalidating sync index");
				return null;
			}

			this.index = parsed;
			return parsed;
		} catch (err) {
			console.warn("SyncIt: Failed to load sync index, starting fresh:", err);
			return null;
		}
	}

	/**
	 * Save the index to disk.
	 */
	async save(index: SyncIndex): Promise<void> {
		this.index = index;
		try {
			const path = `${this.dataDir}/${INDEX_FILENAME}`;
			await this.storage.write(path, JSON.stringify(index, null, 2));
		} catch (err) {
			console.error("SyncIt: Failed to save sync index:", err);
		}
	}

	/**
	 * Clear the in-memory and on-disk index.
	 */
	async clear(): Promise<void> {
		this.index = null;
		try {
			const path = `${this.dataDir}/${INDEX_FILENAME}`;
			if (await this.storage.exists(path)) {
				await this.storage.remove(path);
			}
		} catch (err) {
			console.error("SyncIt: Failed to clear sync index:", err);
		}
	}

	/**
	 * Check if a file is unchanged compared to the index.
	 *
	 * A file is "unchanged" if:
	 * - It exists in the index
	 * - Local mtime and size match the index
	 * - Remote ETag matches the index (most reliable)
	 * - OR remote mtime+size match the index (fallback if no ETag)
	 */
	isUnchanged(
		local: FileEntity,
		remote: FileEntity,
		index: SyncIndex | null,
	): boolean {
		if (!index) return false;

		const entry = index.files[local.path];
		if (!entry) return false;

		// Local must match index exactly
		if (local.mtime !== entry.localMtime || local.size !== entry.localSize) {
			return false;
		}

		// Remote check: prefer ETag, fall back to mtime+size
		if (remote.etag && entry.etag) {
			return remote.etag === entry.etag;
		}

		return remote.mtime === entry.remoteMtime && remote.size === entry.remoteSize;
	}

	/**
	 * Build a fresh index from the results of a successful sync.
	 */
	buildIndex(
		locals: FileEntity[],
		remotes: FileEntity[],
		serverSignature: string,
	): SyncIndex {
		const remoteMap = new Map(remotes.map(r => [r.path, r]));
		const files: Record<string, SyncIndexEntry> = {};

		for (const local of locals) {
			const remote = remoteMap.get(local.path);
			if (!remote) continue; // File was deleted during sync, skip

			files[local.path] = {
				localMtime: local.mtime,
				remoteMtime: remote.mtime,
				localSize: local.size,
				remoteSize: remote.size,
				etag: remote.etag || `${remote.mtime}-${remote.size}`,
			};
		}

		return {
			lastSyncTime: Date.now(),
			serverSignature,
			files,
		};
	}

	/**
	 * Update the index after a partial sync (e.g., only uploads or only downloads).
	 * Preserves entries for files that weren't touched.
	 */
	patchIndex(
		existing: SyncIndex | null,
		updatedLocals: FileEntity[],
		updatedRemotes: FileEntity[],
		serverSignature: string,
	): SyncIndex {
		const remoteMap = new Map(updatedRemotes.map(r => [r.path, r]));
		const files: Record<string, SyncIndexEntry> = { ...existing?.files };

		for (const local of updatedLocals) {
			const remote = remoteMap.get(local.path);
			if (!remote) continue;

			files[local.path] = {
				localMtime: local.mtime,
				remoteMtime: remote.mtime,
				localSize: local.size,
				remoteSize: remote.size,
				etag: remote.etag || `${remote.mtime}-${remote.size}`,
			};
		}

		return {
			lastSyncTime: Date.now(),
			serverSignature,
			files,
		};
	}
}
