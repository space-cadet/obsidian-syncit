import type { FileEntity, SyncPlan, SyncResult } from "../types";
import type { WebDAVAdapter } from "../remote/WebDAVAdapter";
import type { VaultScanner } from "../local/VaultScanner";

/**
 * Builds and executes sync plans by comparing local and remote file states.
 */
export class SyncPlanBuilder {
	constructor(
		private scanner: VaultScanner,
		private adapter: WebDAVAdapter,
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
			} else if (local.mtime > remote.mtime && local.size !== remote.size) {
				// Local is newer and different → upload
				plan.uploads.push(local);
			} else if (remote.mtime > local.mtime && local.size !== remote.size) {
				// Remote is newer and different → download
				plan.downloads.push(remote);
			} else if (local.size === remote.size) {
				// Same size, assume unchanged
				plan.unchanged++;
			} else {
				// Same mtime but different size → conflict
				plan.conflicts.push({ local, remote });
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
	 * Execute a sync plan.
	 */
	async executePlan(
		plan: SyncPlan,
		onProgress?: (current: number, total: number, operation: string, path: string) => void,
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
		let currentOp = 0;

		// Handle uploads
		for (const file of plan.uploads) {
			try {
				onProgress?.(++currentOp, totalOps, "uploading", file.path);
				const content = await this.scanner.readFile(file.path);
				await this.adapter.writeFile(file.path, content);
				result.uploaded++;
			} catch (error) {
				result.errors.push(`Upload failed: ${file.path} — ${error}`);
			}
		}

		// Handle downloads
		for (const file of plan.downloads) {
			try {
				onProgress?.(++currentOp, totalOps, "downloading", file.path);
				const content = await this.adapter.readFile(file.path);
				await this.scanner.writeFile(file.path, content);
				result.downloaded++;
			} catch (error) {
				result.errors.push(`Download failed: ${file.path} — ${error}`);
			}
		}

		// Handle conflicts (keep newer)
		for (const { local, remote } of plan.conflicts) {
			try {
				if (local.mtime >= remote.mtime) {
					onProgress?.(++currentOp, totalOps, "uploading (conflict)", local.path);
					const content = await this.scanner.readFile(local.path);
					await this.adapter.writeFile(local.path, content);
					result.uploaded++;
				} else {
					onProgress?.(++currentOp, totalOps, "downloading (conflict)", remote.path);
					const content = await this.adapter.readFile(remote.path);
					await this.scanner.writeFile(remote.path, content);
					result.downloaded++;
				}
				result.conflicts++;
			} catch (error) {
				result.errors.push(`Conflict resolution failed: ${local.path} — ${error}`);
			}
		}

		return result;
	}
}
