import type {
	FileEntity,
	ReconciliationDecision,
	ReconciliationMode,
	SyncPlan,
	SyncResult,
	SyncIndex,
} from "../types";
import type { SyncIndexManager } from "./SyncIndex";
import { WebDAVAdapter, SyncCancelledError } from "../remote/WebDAVAdapter";
import type { VaultScanner } from "../local/VaultScanner";

/**
 * Builds and executes sync plans by comparing local and remote file states.
 *
 * Architecture: Scan → Compare → Transfer (3 phases)
 * - Phase 1: Scan local and remote file lists
 * - Phase 2: Compare and build plan (uploads, downloads, deletions, skips)
 * - Phase 3: Transfer with size-based progress tracking
 */
export class SyncPlanBuilder {
	constructor(
		private scanner: VaultScanner,
		private adapter: WebDAVAdapter,
		private indexManager?: SyncIndexManager,
		private index?: SyncIndex | null,
	) {}

	// ─── Phase 1: Scan ───

	async scan(): Promise<{ localFiles: FileEntity[]; remoteFiles: FileEntity[] }> {
		const [localFiles, remoteFiles] = await Promise.all([
			this.scanner.scan(),
			this.adapter.listFiles(),
		]);
		return { localFiles, remoteFiles };
	}

	// ─── Phase 2: Compare & Build Plan ───

	buildPlan(localFiles: FileEntity[], remoteFiles: FileEntity[], mode: ReconciliationMode = "two-way"): SyncPlan {
		const localMap = new Map(localFiles.map(f => [f.path, f]));
		const remoteMap = new Map(remoteFiles.map(f => [f.path, f]));

		const plan: SyncPlan = {
			uploads: [],
			downloads: [],
			localDeletes: [],
			remoteDeletes: [],
			conflicts: [],
			reconciliation: [],
			requiresReconciliation: false,
			unchanged: 0,
			uploadSize: 0,
			downloadSize: 0,
		};

		// Check all local files
		for (const local of localFiles) {
			const remote = remoteMap.get(local.path);
			if (!remote) {
				if (mode === "download-only") continue;
				if (!this.index) {
					plan.reconciliation.push({
						path: local.path,
						reason: "no-baseline-local-only",
						local,
					});
				} else if (this.index.files[local.path]) {
					// A previously synced path is missing remotely. Do not assume local wins.
					plan.reconciliation.push({
						path: local.path,
						reason: "possible-remote-deletion",
						local,
					});
				} else {
					// A path not present in a valid local baseline is a new local file.
					plan.uploads.push(local);
					plan.uploadSize += local.size;
				}
				continue;
			} else if (this.indexManager?.isUnchanged(local, remote, this.index ?? null)) {
				// T12d: Both sides match the index → skip
				plan.unchanged++;
			} else if (local.mtime !== remote.mtime || local.size !== remote.size) {
				if (!this.index) {
					plan.reconciliation.push({
						path: local.path,
						reason: "no-baseline-conflict",
						local,
						remote,
					});
					continue;
				}
				// File changed on one or both sides
				if (mode === "upload-only" || (mode === "two-way" && local.mtime > remote.mtime)) {
					plan.uploads.push(local);
					plan.uploadSize += local.size;
				} else if (mode === "download-only" || (mode === "two-way" && remote.mtime > local.mtime)) {
					plan.downloads.push(remote);
					plan.downloadSize += remote.size;
				} else {
					// Same mtime but different size (rare) → conflict
					plan.conflicts.push({ local, remote });
				}
			} else {
				// Both mtime and size match → unchanged
				plan.unchanged++;
			}
		}

		// Check remote files that don't exist locally
		for (const remote of remoteFiles) {
			const local = localMap.get(remote.path);
			if (!local) {
				if (mode === "upload-only") continue;
				if (!this.index) {
					plan.reconciliation.push({
						path: remote.path,
						reason: "no-baseline-remote-only",
						remote,
					});
				} else if (this.index.files[remote.path]) {
					// A previously synced path is missing locally. Do not delete remotely silently.
					plan.reconciliation.push({
						path: remote.path,
						reason: "possible-local-deletion",
						remote,
					});
				} else {
					// A path not present in a valid local baseline is a new remote file.
					plan.downloads.push(remote);
					plan.downloadSize += remote.size;
				}
			}
		}

		plan.requiresReconciliation = plan.reconciliation.length > 0;

		return plan;
	}

	/**
	 * Turn explicit reconciliation choices into ordinary transfer operations.
	 * Unresolved choices remain blocked so a skipped item cannot become an
	 * accidental upload on the next run.
	 */
	applyReconciliationDecisions(
		plan: SyncPlan,
		decisions: Record<string, ReconciliationDecision>,
		mode: ReconciliationMode,
	): SyncPlan {
		const resolved: SyncPlan = {
			...plan,
			uploads: [...plan.uploads],
			downloads: [...plan.downloads],
			localDeletes: [...plan.localDeletes],
			remoteDeletes: [...plan.remoteDeletes],
			conflicts: [...plan.conflicts],
			reconciliation: [],
			requiresReconciliation: false,
		};
		const occupiedPaths = new Set([
			...plan.uploads.map(file => file.path),
			...plan.downloads.map(file => file.path),
			...plan.reconciliation.map(item => item.path),
		]);

		for (const item of plan.reconciliation) {
			const decision = decisions[item.path] ??
				(mode === "upload-only" ? "use-local" : mode === "download-only" ? "use-remote" : "skip");
			if (decision === "skip") {
				resolved.reconciliation.push(item);
				continue;
			}

			if (decision === "use-local") {
				if (item.local) {
					resolved.uploads.push(item.local);
					resolved.uploadSize += item.local.size;
				} else if (item.remote) {
					resolved.remoteDeletes.push(item.remote);
				}
				continue;
			}

			if (decision === "use-remote") {
				if (item.remote) {
					resolved.downloads.push(item.remote);
					resolved.downloadSize += item.remote.size;
				} else if (item.local) {
					resolved.localDeletes.push(item.local);
				}
				continue;
			}

			// Keeping both is meaningful for a same-path conflict. For a file
			// present on only one side, preserving that side is the safe result.
			if (item.local && item.remote) {
				const copyPath = makeCopyPath(item.local.path, "local", occupiedPaths);
				occupiedPaths.add(copyPath);
				resolved.uploads.push({ ...item.local, targetPath: copyPath });
				resolved.uploadSize += item.local.size;
			} else if (item.local) {
				resolved.uploads.push(item.local);
				resolved.uploadSize += item.local.size;
			} else if (item.remote) {
				resolved.downloads.push(item.remote);
				resolved.downloadSize += item.remote.size;
			}
		}

		resolved.requiresReconciliation = resolved.reconciliation.length > 0;
		return resolved;
	}

	// ─── Phase 3: Transfer ───

	async executePlan(
		plan: SyncPlan,
		concurrencyLimit: number = 3,
		onProgress?: (current: number, total: number, operation: string, path: string, bytesTransferred: number, totalBytes: number) => void,
		isCancelled?: () => boolean,
	): Promise<SyncResult> {
		const result: SyncResult = {
			uploaded: 0,
			downloaded: 0,
			deleted: 0,
			conflicts: 0,
			skipped: plan.unchanged,
			errors: [],
			uploadedBytes: 0,
			downloadedBytes: 0,
		};

		const totalOps = plan.uploads.length + plan.downloads.length + plan.localDeletes.length + plan.conflicts.length + plan.remoteDeletes.length;
		let completedOps = 0;
		const totalTransferBytes = plan.uploadSize + plan.downloadSize;

		const reportProgress = (operation: string, path: string, bytesTransferred: number) => {
			completedOps++;
			onProgress?.(completedOps, totalOps, operation, path, bytesTransferred, totalTransferBytes);
		};

		// Handle uploads in parallel
		if (plan.uploads.length > 0) {
			if (isCancelled?.() || this.adapter.isAborted()) throw new SyncCancelledError();
			await runWithConcurrency(plan.uploads, concurrencyLimit, async (file) => {
				if (this.adapter.isAborted()) throw new SyncCancelledError();
				try {
					const content = await this.scanner.readFile(file.path);
					await this.adapter.writeFile(file.targetPath ?? file.path, content);
					result.uploaded++;
					result.uploadedBytes += file.size;
					reportProgress("uploading", file.targetPath ?? file.path, result.uploadedBytes + result.downloadedBytes);
				} catch (error) {
					if (error instanceof SyncCancelledError) throw error;
					result.errors.push(`Upload failed: ${file.path} — ${error}`);
					reportProgress("uploading (error)", file.path, result.uploadedBytes + result.downloadedBytes);
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
					result.downloadedBytes += file.size;
					reportProgress("downloading", file.path, result.uploadedBytes + result.downloadedBytes);
				} catch (error) {
					if (error instanceof SyncCancelledError) throw error;
					result.errors.push(`Download failed: ${file.path} — ${error}`);
					reportProgress("downloading (error)", file.path, result.uploadedBytes + result.downloadedBytes);
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
						result.uploadedBytes += local.size;
						reportProgress("uploading (conflict)", local.path, result.uploadedBytes + result.downloadedBytes);
					} else {
						const content = await this.adapter.readFile(remote.path);
						await this.scanner.writeFile(remote.path, content);
						result.downloaded++;
						result.downloadedBytes += remote.size;
						reportProgress("downloading (conflict)", remote.path, result.uploadedBytes + result.downloadedBytes);
					}
					result.conflicts++;
				} catch (error) {
					if (error instanceof SyncCancelledError) throw error;
					result.errors.push(`Conflict resolution failed: ${local.path} — ${error}`);
					reportProgress("conflict (error)", local.path, result.uploadedBytes + result.downloadedBytes);
				}
			});
		}

		// Handle local deletions (sequential — destructive, normally to trash)
		if (plan.localDeletes.length > 0) {
			if (isCancelled?.() || this.adapter.isAborted()) throw new SyncCancelledError();
			for (const file of plan.localDeletes) {
				if (this.adapter.isAborted()) throw new SyncCancelledError();
				try {
					await this.scanner.deleteFile(file.path);
					result.deleted++;
					reportProgress("deleting-local", file.path, result.uploadedBytes + result.downloadedBytes);
				} catch (error) {
					if (error instanceof SyncCancelledError) throw error;
					result.errors.push(`Local delete failed: ${file.path} — ${error}`);
					reportProgress("delete-local (error)", file.path, result.uploadedBytes + result.downloadedBytes);
				}
			}
		}

		// Handle remote deletions (sequential — destructive)
		if (plan.remoteDeletes.length > 0) {
			if (isCancelled?.() || this.adapter.isAborted()) throw new SyncCancelledError();
			for (const file of plan.remoteDeletes) {
				if (this.adapter.isAborted()) throw new SyncCancelledError();
				try {
					await this.adapter.deleteFile(file.path);
					result.deleted++;
					reportProgress("deleting", file.path, result.uploadedBytes + result.downloadedBytes);
				} catch (error) {
					if (error instanceof SyncCancelledError) throw error;
					result.errors.push(`Delete failed: ${file.path} — ${error}`);
					reportProgress("delete (error)", file.path, result.uploadedBytes + result.downloadedBytes);
				}
			}
		}

		return result;
	}
}

/**
 * Run an array of operations with a concurrency limit.
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
			try {
				await Promise.race(executing);
			} catch (error) {
				// A cancellation/error must not let main.ts disconnect while
				// other already-started operations are still running.
				await Promise.allSettled(executing);
				throw error;
			}
		}
	}

	try {
		await Promise.all(executing);
	} catch (error) {
		await Promise.allSettled(executing);
		throw error;
	}
}

function makeCopyPath(path: string, side: "local" | "remote", occupied: Set<string>): string {
	const separator = path.lastIndexOf("/");
	const directory = separator >= 0 ? path.slice(0, separator + 1) : "";
	const filename = separator >= 0 ? path.slice(separator + 1) : path;
	const extensionIndex = filename.lastIndexOf(".");
	const stem = extensionIndex > 0 ? filename.slice(0, extensionIndex) : filename;
	const extension = extensionIndex > 0 ? filename.slice(extensionIndex) : "";
	let candidate = `${directory}${stem} (${side} copy)${extension}`;
	let counter = 2;
	while (occupied.has(candidate)) {
		candidate = `${directory}${stem} (${side} copy ${counter++})${extension}`;
	}
	return candidate;
}
