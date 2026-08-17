import type { FileEntity, SyncPlan, SyncResult, SyncIndex } from "../types";
import type { SyncIndexManager } from "./SyncIndex";
import { WebDAVAdapter, SyncCancelledError } from "../remote/WebDAVAdapter";
import type { VaultScanner } from "../local/VaultScanner";

/**
 * Builds and executes sync plans by comparing local and remote file states.
 */
export class SyncPlanBuilder {
	constructor(
		private scanner: VaultScanner,
		private adapter: WebDAVAdapter,
		private indexManager?: SyncIndexManager,
		private index?: SyncIndex | null,
	) {}

	/**
	 * Build a sync plan by comparing local and remote files.
	 */
	async buildPlan(): Promise<SyncPlan> {
		const [localFiles, remoteFiles] = await Promise.all([
			this.scanner.scan(),
			this.adapter.listFiles(),
		]);

		const localMap = new Map(localFiles.map(f => [f.path, f]));
		const remoteMap = new Map(remoteFiles.map(f => [f.path, f]));

		const plan: SyncPlan = {
			uploads: [],
			downloads: [],
			localDeletes: [],
			remoteDeletes: [],
			conflicts: [],
			unchanged: 0,
		};

		// Check all local files
		for (const local of localFiles) {
			const remote = remoteMap.get(local.path);
			if (!remote) {
				// File exists locally but not remotely → upload
				plan.uploads.push(local);
			} else if (this.indexManager?.isUnchanged(local, remote, this.index ?? null)) {
				// T12d: Both sides match the index → skip without further comparison
				plan.unchanged++;
			} else if (local.mtime !== remote.mtime || local.size !== remote.size) {
				// mtime OR size differs → file changed on one side
				// Determine direction by comparing mtimes
				if (local.mtime > remote.mtime) {
					plan.uploads.push(local);
				} else if (remote.mtime > local.mtime) {
					plan.downloads.push(remote);
				} else {
					// Same mtime but different size (rare) → conflict
					plan.conflicts.push({ local, remote });
				}
			} else {
				// Both mtime and size match → unchanged
				plan.unchanged++;
			}
		}

		// Check all remote files
		for (const remote of remoteFiles) {
			const local = localMap.get(remote.path);
			if (!local) {
				// File exists remotely but not locally → download
				plan.downloads.push(remote);
			}
		}

		return plan;
	}

	/**
	 * Execute a sync plan with configurable concurrency.
	 * @param concurrencyLimit - Max parallel operations (default: 3)
	 * @param isCancelled - Optional function called between batches; if it returns true, sync aborts.
	 */
	async executePlan(
		plan: SyncPlan,
		concurrencyLimit: number = 3,
		onProgress?: (current: number, total: number, operation: string, path: string) => void,
		isCancelled?: () => boolean,
	): Promise<SyncResult> {
		const result: SyncResult = {
			uploaded: 0,
			downloaded: 0,
			deleted: 0,
			conflicts: 0,
			skipped: 0,
			errors: [],
		};

		const totalOps = plan.uploads.length + plan.downloads.length + plan.conflicts.length;
		let completedOps = 0;

		const reportProgress = (operation: string, path: string) => {
			onProgress?.(++completedOps, totalOps, operation, path);
		};

		// Handle uploads in parallel
		if (plan.uploads.length > 0) {
			if (isCancelled?.() || this.adapter.isAborted()) throw new SyncCancelledError();
			await runWithConcurrency(plan.uploads, concurrencyLimit, async (file) => {
				if (this.adapter.isAborted()) throw new SyncCancelledError();
				try {
					const content = await this.scanner.readFile(file.path);
					await this.adapter.writeFile(file.path, content);
					result.uploaded++;
					reportProgress("uploading", file.path);
				} catch (error) {
					if (error instanceof SyncCancelledError) throw error;
					result.errors.push(`Upload failed: ${file.path} — ${error}`);
					reportProgress("uploading (error)", file.path);
				}
			});
		}

		// Handle downloads in parallel
		if (plan.downloads.length > 0) {
			if (isCancelled?.() || this.adapter.isAborted()) throw new SyncCancelledError();
			await runWithConcurrency(plan.downloads, concurrencyLimit, async (file) => {
				if (this.adapter.isAborted()) throw new SyncCancelledError();
				try {
					const content = await this.adapter.readFile(file.path);
					await this.scanner.writeFile(file.path, content);
					result.downloaded++;
					reportProgress("downloading", file.path);
				} catch (error) {
					if (error instanceof SyncCancelledError) throw error;
					result.errors.push(`Download failed: ${file.path} — ${error}`);
					reportProgress("downloading (error)", file.path);
				}
			});
		}

		// Handle conflicts in parallel
		if (plan.conflicts.length > 0) {
			if (isCancelled?.() || this.adapter.isAborted()) throw new SyncCancelledError();
			await runWithConcurrency(plan.conflicts, concurrencyLimit, async ({ local, remote }) => {
				if (this.adapter.isAborted()) throw new SyncCancelledError();
				try {
					if (local.mtime >= remote.mtime) {
						const content = await this.scanner.readFile(local.path);
						await this.adapter.writeFile(local.path, content);
						result.uploaded++;
						reportProgress("uploading (conflict)", local.path);
					} else {
						const content = await this.adapter.readFile(remote.path);
						await this.scanner.writeFile(remote.path, content);
						result.downloaded++;
						reportProgress("downloading (conflict)", remote.path);
					}
					result.conflicts++;
				} catch (error) {
					if (error instanceof SyncCancelledError) throw error;
					result.errors.push(`Conflict resolution failed: ${local.path} — ${error}`);
					reportProgress("conflict (error)", local.path);
				}
			});
		}

		return result;
	}
}

/**
 * Run an array of operations with a concurrency limit.
 *
 * @param items - Array of items to process
 * @param limit - Maximum number of concurrent operations
 * @param fn - Async function to run for each item
 */
async function runWithConcurrency<T>(
	items: T[],
	limit: number,
	fn: (item: T) => Promise<void>,
): Promise<void> {
	if (limit <= 0) limit = 1;
	if (items.length === 0) return;

	const executing = new Set<Promise<void>>();

	for (const item of items) {
		const p = fn(item).finally(() => executing.delete(p));
		executing.add(p);

		if (executing.size >= limit) {
			await Promise.race(executing);
		}
	}

	await Promise.all(executing);
}


