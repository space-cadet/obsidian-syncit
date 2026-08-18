import { App, Notice, Plugin, Platform, WorkspaceLeaf } from "obsidian";
import type {
	ReconciliationDecision,
	ReconciliationMode,
	SyncItSettings,
	SyncPlan,
} from "./types";
import { DEFAULT_SETTINGS } from "./types";
import { SyncItSettingTab } from "./settings";
import { WebDAVAdapter, SyncCancelledError } from "./remote/WebDAVAdapter";
import { VaultScanner } from "./local/VaultScanner";
import { SyncPlanBuilder } from "./sync/SyncPlan";
import { SyncIndexManager, type IndexStorage } from "./sync/SyncIndex";
import { PluginUpdater, UpdateAvailableModal } from "./updater/PluginUpdater";
import { SyncSidebarView, SYNC_SIDEBAR_VIEW_TYPE } from "./ui/SyncSidebarView";

export default class SyncItPlugin extends Plugin {
	settings: SyncItSettings = DEFAULT_SETTINGS;
	private adapter: WebDAVAdapter | null = null;
	private scanner: VaultScanner | null = null;
	private indexManager: SyncIndexManager | null = null;
	private isSyncing = false;
	private statusBarEl: HTMLSpanElement | null = null;
	private _updater: PluginUpdater | null = null;
	private _sidebarView: SyncSidebarView | null = null;
	private debugLogPath = `.obsidian/plugins/${this.manifest?.id ?? "obsidian-syncit"}/debug.log`;
	private lastSavedServerConfig: {
		webdavUrl: string;
		webdavUsername: string;
		webdavPassword: string;
		remoteBaseDir: string;
	} | null = null;
	private pendingReconciliation: {
		key: string;
		mode: ReconciliationMode;
		decisions: Record<string, ReconciliationDecision>;
	} | null = null;

	/** Append a line to the plugin debug log. */
	private async _logDebug(level: string, message: string): Promise<void> {
		try {
			const path = this.debugLogPath;
			const existing = await this.app.vault.adapter.exists(path)
				? await this.app.vault.adapter.read(path)
				: "";
			const lines = existing.split("\n").slice(-499);
			lines.push(`[${new Date().toISOString()}] [${level}] ${message}`);
			await this.app.vault.adapter.write(path, lines.join("\n"));
		} catch {
			// Silently fail
		}
	}

	async onload() {
		console.info(`Loading SyncIt plugin`);

		await this.loadSettings();
		this.lastSavedServerConfig = this.getServerConfigSnapshot();

		this.adapter = new WebDAVAdapter();
		this.scanner = new VaultScanner(this.app, this.settings);
		try {
			await this.scanner.cleanupTempFiles();
		} catch (error) {
			await this._logDebug("WARN", `Temporary-file cleanup failed: ${String(error)}`);
		}

		// T12d: Set up sync index manager
		const pluginDir = `${this.app.vault.configDir}/plugins/${this.manifest.id}`;
		const storage: IndexStorage = {
			exists: (path) => this.app.vault.adapter.exists(path),
			read: (path) => this.app.vault.adapter.read(path),
			write: (path, data) => this.app.vault.adapter.write(path, data),
			remove: (path) => this.app.vault.adapter.remove(path),
		};
		this.indexManager = new SyncIndexManager(pluginDir, storage);

		// Ribbon icon
		this.addRibbonIcon("sync", "SyncIt: Sync vault", () => {
			this.performSync();
		});

		// Command: Sync
		this.addCommand({
			id: "syncit-sync",
			name: "Sync vault now",
			callback: () => this.performSync(),
		});

		// Command: Open sidebar
		this.addCommand({
			id: "syncit-open-sidebar",
			name: "Open SyncIt sidebar",
			callback: () => this.openSidebarView(),
		});

		// Command: Dry Run
		this.addCommand({
			id: "syncit-dry-run",
			name: "Dry run — preview what would sync",
			callback: () => this.performDryRun(),
		});

		// Command: Rebuild Index (no transfers — just scan and save)
		this.addCommand({
			id: "syncit-rebuild-index",
			name: "Rebuild sync index",
			callback: () => this.rebuildIndex(),
		});

		// Register sidebar view
		this.registerView(SYNC_SIDEBAR_VIEW_TYPE, (leaf) => {
			this._sidebarView = new SyncSidebarView(leaf, this);
			return this._sidebarView;
		});

		// Updater
		this._updater = new PluginUpdater(this.app, this.manifest.id);
		this.addCommand({
			id: "syncit-check-updates",
			name: "Check for updates",
			callback: () => this.checkForUpdates(true),
		});

		// Auto-check on startup (delayed)
		if (this.settings.checkForUpdates) {
			window.setTimeout(() => {
				this.checkForUpdates(false);
			}, 30 * 1000);
		}

		// Status bar
		if (!Platform.isMobile) {
			const statusBarItem = this.addStatusBarItem();
			this.statusBarEl = statusBarItem.createEl("span");
			this.updateStatusBar("Ready");
		}

		// Settings tab
		this.addSettingTab(new SyncItSettingTab(this.app, this));

		// Restore sidebar if it was open
		this.app.workspace.onLayoutReady(() => {
			this.restoreSidebarView();
		});
	}

	onunload() {
		console.info(`Unloading SyncIt plugin`);
		this.statusBarEl = null;
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);

		// Settings controls mutate this.settings before calling saveSettings().
		// Compare against the last successfully persisted snapshot instead of
		// treating the already-mutated object as the old value.
		const currentConfig = this.getServerConfigSnapshot();
		const previousConfig = this.lastSavedServerConfig;
		const serverConfigChanged =
			!previousConfig ||
			currentConfig.webdavUrl !== previousConfig.webdavUrl ||
			currentConfig.webdavUsername !== previousConfig.webdavUsername ||
			currentConfig.webdavPassword !== previousConfig.webdavPassword ||
			currentConfig.remoteBaseDir !== previousConfig.remoteBaseDir;

		if (serverConfigChanged) {
			await this.indexManager?.clear();
		}
		this.lastSavedServerConfig = currentConfig;
	}

	refreshSidebarMode() {
		this._sidebarView?.updateSyncMode();
	}

	private getServerConfigSnapshot() {
		return {
			webdavUrl: this.settings.webdavUrl,
			webdavUsername: this.settings.webdavUsername,
			webdavPassword: this.settings.webdavPassword,
			remoteBaseDir: this.settings.remoteBaseDir,
		};
	}

	/** Cancel an in-progress sync. Called from sidebar cancel button. */
	cancelSync() {
		this.adapter?.abort();
	}

	/** Apply the decisions selected in the reconciliation review. */
	applyReconciliation(
		plan: SyncPlan,
		mode: ReconciliationMode,
		decisions: Record<string, ReconciliationDecision>,
	) {
		this.pendingReconciliation = {
			key: this.reconciliationKey(plan),
			mode,
			decisions,
		};
		void this.performSync();
	}

	/** Cancel a reconciliation review without changing local or remote files. */
	cancelReconciliation() {
		this.pendingReconciliation = null;
		this._sidebarView?.setCancelled();
		this.updateStatusBar("Ready");
	}

	private reconciliationKey(plan: SyncPlan): string {
		return plan.reconciliation
			.map(item => `${item.path}:${item.reason}`)
			.sort()
			.join("|");
	}

	async performSync(mode: ReconciliationMode = this.settings.syncDirection) {
		if (this.isSyncing) {
			new Notice("SyncIt: Sync already in progress");
			return;
		}

		if (!this.settings.webdavUrl) {
			new Notice("SyncIt: Please configure WebDAV settings first");
			return;
		}

		this.isSyncing = true;
		this.updateStatusBar("Syncing...");
		this._sidebarView?.setSyncing(true);

		// T3a: Open sidebar to show progress
		this.openSidebarView();
		this._sidebarView?.setScanning();
		new Notice("SyncIt: Sync started — see sidebar for progress", 3000);

		try {
			// Initialize adapter
			if (!this.adapter || !this.scanner) {
				this.adapter = new WebDAVAdapter();
				this.scanner = new VaultScanner(this.app, this.settings);
			}
			await this.adapter.initialize({
				url: this.settings.webdavUrl,
				username: this.settings.webdavUsername,
				password: this.settings.webdavPassword,
				baseDir: this.settings.remoteBaseDir,
			});
			this.adapter.startSession();

			// T12d: Load sync index
			const serverSignature = SyncIndexManager.makeServerSignature({
				url: this.settings.webdavUrl,
				username: this.settings.webdavUsername,
				baseDir: this.settings.remoteBaseDir,
			});
			const index = await this.indexManager?.load(serverSignature) ?? null;

			// Phase 1: Scan
			const builder = new SyncPlanBuilder(this.scanner!, this.adapter!, this.indexManager ?? undefined, index);
			const { localFiles, remoteFiles } = await builder.scan();

			// Phase 2: Build plan
			let plan = builder.buildPlan(localFiles, remoteFiles, mode);

			if (plan.requiresReconciliation) {
				if (this.settings.reconciliationPolicy === "follow-direction") {
					plan = builder.applyReconciliationDecisions(plan, {}, mode);
				}
			}
			if (plan.requiresReconciliation) {
				const pending = this.pendingReconciliation;
				if (!pending || pending.key !== this.reconciliationKey(plan)) {
					this.pendingReconciliation = null;
					this._sidebarView?.setReconciliationRequired(plan);
					new Notice(
						`SyncIt: ${plan.reconciliation.length} file(s) need reconciliation before syncing`,
						10000,
					);
					this.updateStatusBar("Reconciliation required");
					return;
				}
				plan = builder.applyReconciliationDecisions(plan, pending.decisions, pending.mode);
				this.pendingReconciliation = null;
				if (plan.requiresReconciliation) {
					this._sidebarView?.setReconciliationRequired(plan);
					new Notice("SyncIt: Choose a decision for every file before applying", 10000);
					this.updateStatusBar("Reconciliation incomplete");
					return;
				}
			}

			this._sidebarView?.setPlan(plan);

			const totalOps = plan.uploads.length + plan.downloads.length + plan.localDeletes.length + plan.conflicts.length + plan.remoteDeletes.length;

			if (totalOps === 0) {
				this._sidebarView?.finish({
					uploaded: 0,
					downloaded: 0,
					deleted: 0,
					conflicts: 0,
					skipped: plan.unchanged,
					errors: [],
					uploadedBytes: 0,
					downloadedBytes: 0,
					message: "Already up to date",
				});
				this.updateStatusBar("Up to date");
				return;
			}

			// Phase 3: Transfer with size-based progress
			const result = await builder.executePlan(
				plan,
				this.settings.concurrencyLimit,
				(current, total, operation, path, bytesTransferred, totalBytes) => {
					this._sidebarView?.updateProgress(current, total, operation, path, bytesTransferred, totalBytes);
					this.updateStatusBar(`${operation} ${current}/${total}`);
				},
				() => !this.isSyncing,
			);

			// Report results
			const messages: string[] = [];
			if (result.uploaded > 0) messages.push(`${result.uploaded} uploaded`);
			if (result.downloaded > 0) messages.push(`${result.downloaded} downloaded`);
			if (result.conflicts > 0) messages.push(`${result.conflicts} conflicts resolved`);
			if (result.errors.length > 0) messages.push(`${result.errors.length} errors`);

			const msg = messages.join(", ") || "Nothing to sync";
			const fullResult = { ...result, message: msg };

			this._sidebarView?.finish(fullResult);
			new Notice(`SyncIt: ${msg}`);
			const timeStr = new Date().toLocaleTimeString();
			this.updateStatusBar(`Last sync: ${timeStr}`);

			// T12d: Update sync index only after a fully successful sync. A
			// partial result must remain retryable on the next run.
			if (result.errors.length === 0 && this.indexManager && this.adapter && this.scanner) {
				try {
					// Fresh scan of current state on both sides
					const { localFiles: freshLocals, remoteFiles: freshRemotes } =
						await builder.scan();
					const freshIndex = this.indexManager.buildIndex(
						freshLocals,
						freshRemotes,
						serverSignature,
					);
					await this.indexManager.save(freshIndex);
					console.info("SyncIt: Sync index updated with fresh ETags");
				} catch (indexErr) {
					console.warn("SyncIt: Failed to update sync index:", indexErr);
				}
			}

			if (result.errors.length > 0) {
				console.error("SyncIt errors:", result.errors);
			}
		} catch (error) {
			if (error instanceof SyncCancelledError) {
				new Notice("SyncIt: Sync cancelled");
				this.updateStatusBar("Sync cancelled");
				this._sidebarView?.setCancelled();
				return;
			}
			console.error("SyncIt sync failed:", error);
			const errorMsg = error instanceof Error ? error.message : String(error);
			this._sidebarView?.setError(errorMsg);
			new Notice(`SyncIt: Sync failed — ${errorMsg}`, 10000);
			this.updateStatusBar("Sync failed");
		} finally {
			this.isSyncing = false;
			this._sidebarView?.setSyncing(false);
			if (this.adapter) {
				await this.adapter.disconnect();
			}
		}
	}

	/** Dry run: scan and build plan, but do not transfer anything. */
	async performDryRun() {
		if (this.isSyncing) {
			new Notice("SyncIt: Sync already in progress");
			return;
		}

		if (!this.settings.webdavUrl) {
			new Notice("SyncIt: Please configure WebDAV settings first");
			return;
		}

		this.isSyncing = true;
		this.pendingReconciliation = null;
		this.updateStatusBar("Dry run...");
		this._sidebarView?.setSyncing(true);
		this.openSidebarView();
		this._sidebarView?.setScanning();
		new Notice("SyncIt: Dry run started — previewing changes", 3000);

		try {
			if (!this.adapter || !this.scanner) {
				this.adapter = new WebDAVAdapter();
				this.scanner = new VaultScanner(this.app, this.settings);
			}
			await this.adapter.initialize({
				url: this.settings.webdavUrl,
				username: this.settings.webdavUsername,
				password: this.settings.webdavPassword,
				baseDir: this.settings.remoteBaseDir,
			});

			const serverSignature = SyncIndexManager.makeServerSignature({
				url: this.settings.webdavUrl,
				username: this.settings.webdavUsername,
				baseDir: this.settings.remoteBaseDir,
			});
			const index = await this.indexManager?.load(serverSignature) ?? null;

			// DEBUG: Log index state
			await this._logDebug("INFO", `DryRun signature=${serverSignature}`);
			await this._logDebug("INFO", `DryRun index loaded=${index ? "YES" : "NO"}`);
			if (index) {
				const entryCount = Object.keys(index.files).length;
				await this._logDebug("INFO", `DryRun index entries=${entryCount}`);
			} else {
				// Try to read the raw index file to show stored signature
				try {
					const rawPath = `${this.app.vault.configDir}/plugins/${this.manifest.id}/sync-index.json`;
					if (await this.app.vault.adapter.exists(rawPath)) {
						const raw = await this.app.vault.adapter.read(rawPath);
						const parsed = JSON.parse(raw);
						await this._logDebug("INFO", `DryRun index file signature=${parsed.serverSignature}`);
					} else {
						await this._logDebug("INFO", "DryRun index file not found on disk");
					}
				} catch (e) {
					await this._logDebug("INFO", "DryRun failed to read index file");
				}
			}

			const builder = new SyncPlanBuilder(this.scanner!, this.adapter!, this.indexManager ?? undefined, index);
			const { localFiles, remoteFiles } = await builder.scan();

			// DEBUG: Log scan results
			await this._logDebug("INFO", `DryRun local=${localFiles.length} remote=${remoteFiles.length}`);

			const plan = builder.buildPlan(localFiles, remoteFiles, this.settings.syncDirection);

			// DEBUG: Log plan summary
			await this._logDebug("INFO", `DryRun plan: uploads=${plan.uploads.length} downloads=${plan.downloads.length} deletes=${plan.remoteDeletes.length} conflicts=${plan.conflicts.length} unchanged=${plan.unchanged}`);

			this._sidebarView?.setPlan(plan);

			if (plan.requiresReconciliation) {
				this._sidebarView?.setReconciliationRequired(plan);
				new Notice(
					`SyncIt: Dry run found ${plan.reconciliation.length} file(s) needing reconciliation`,
					10000,
				);
				this.updateStatusBar("Reconciliation required");
				return;
			}

			const totalOps = plan.uploads.length + plan.downloads.length + plan.localDeletes.length + plan.conflicts.length + plan.remoteDeletes.length;

			if (totalOps === 0) {
				this._sidebarView?.finish({
					uploaded: 0,
					downloaded: 0,
					deleted: 0,
					conflicts: 0,
					skipped: plan.unchanged,
					errors: [],
					uploadedBytes: 0,
					downloadedBytes: 0,
					message: "Already up to date",
				});
				new Notice("SyncIt: Already up to date");
				this.updateStatusBar("Up to date");
				return;
			}

			// Simulate progress for each operation (no artificial delay)
			let current = 0;
			const total = totalOps;
			const allOps = [
				...plan.uploads.map(f => ({ op: "uploading (dry-run)", path: f.path, size: f.size })),
				...plan.downloads.map(f => ({ op: "downloading (dry-run)", path: f.path, size: f.size })),
				...plan.conflicts.map(c => ({ op: "conflict (dry-run)", path: c.local.path, size: Math.max(c.local.size, c.remote.size) })),
				...plan.localDeletes.map(f => ({ op: "deleting-local (dry-run)", path: f.path, size: 0 })),
				...plan.remoteDeletes.map(f => ({ op: "deleting (dry-run)", path: f.path, size: 0 })),
			];

			for (const op of allOps) {
				current++;
				this._sidebarView?.updateProgress(current, total, op.op, op.path, 0, 0);
			}

			const result = {
				uploaded: plan.uploads.length,
				downloaded: plan.downloads.length,
				deleted: plan.localDeletes.length + plan.remoteDeletes.length,
				conflicts: plan.conflicts.length,
				skipped: plan.unchanged,
				errors: [],
				uploadedBytes: plan.uploadSize,
				downloadedBytes: plan.downloadSize,
				message: `${plan.uploads.length}↑ ${plan.downloads.length}↓ ${plan.localDeletes.length + plan.remoteDeletes.length}🗑 ${plan.conflicts.length}⚠️`,
			};

			this._sidebarView?.showDryRunResult(result);
			new Notice(`SyncIt: Dry run complete — ${result.message}`);
			this.updateStatusBar("Dry run complete");
		} catch (error) {
			console.error("SyncIt dry run failed:", error);
			const errorMsg = error instanceof Error ? error.message : String(error);
			this._sidebarView?.setError(errorMsg);
			new Notice(`SyncIt: Dry run failed — ${errorMsg}`, 10000);
			this.updateStatusBar("Dry run failed");
		} finally {
			this.isSyncing = false;
			this._sidebarView?.setSyncing(false);
			if (this.adapter) {
				await this.adapter.disconnect();
			}
		}
	}

	async testConnection(): Promise<{ success: boolean; message: string }> {
		try {
			const testAdapter = new WebDAVAdapter();
			await testAdapter.initialize({
				url: this.settings.webdavUrl,
				username: this.settings.webdavUsername,
				password: this.settings.webdavPassword,
				baseDir: this.settings.remoteBaseDir,
			});
			const result = await testAdapter.testConnection();
			await testAdapter.disconnect();
			return result;
		} catch (error) {
			return {
				success: false,
				message: error instanceof Error ? error.message : "Connection failed",
			};
		}
	}

	/** Rebuild the sync index from a fresh scan — no transfers. */
	async rebuildIndex() {
		if (this.isSyncing) {
			new Notice("SyncIt: Another sync operation is already in progress");
			return;
		}

		if (!this.settings.webdavUrl) {
			new Notice("SyncIt: Please configure WebDAV settings first");
			return;
		}

		this.isSyncing = true;
		new Notice("SyncIt: Rebuilding index...", 2000);
		this.updateStatusBar("Rebuilding index...");

		try {
			if (!this.adapter || !this.scanner) {
				this.adapter = new WebDAVAdapter();
				this.scanner = new VaultScanner(this.app, this.settings);
			}
			await this.adapter.initialize({
				url: this.settings.webdavUrl,
				username: this.settings.webdavUsername,
				password: this.settings.webdavPassword,
				baseDir: this.settings.remoteBaseDir,
			});

			const serverSignature = SyncIndexManager.makeServerSignature({
				url: this.settings.webdavUrl,
				username: this.settings.webdavUsername,
				baseDir: this.settings.remoteBaseDir,
			});

			const builder = new SyncPlanBuilder(
				this.scanner,
				this.adapter,
				this.indexManager ?? undefined,
				null,
			);
			const { localFiles, remoteFiles } = await builder.scan();

			if (this.indexManager) {
				const index = this.indexManager.buildIndex(
					localFiles,
					remoteFiles,
					serverSignature,
				);
				await this.indexManager.save(index);
				new Notice(`SyncIt: Index rebuilt — ${localFiles.length} local, ${remoteFiles.length} remote files`, 4000);
				this.updateStatusBar("Index rebuilt");
			}
		} catch (error) {
			console.error("SyncIt rebuild index failed:", error);
			const msg = error instanceof Error ? error.message : String(error);
			new Notice(`SyncIt: Index rebuild failed — ${msg}`, 6000);
			this.updateStatusBar("Index rebuild failed");
		} finally {
			this.isSyncing = false;
			if (this.adapter) {
				await this.adapter.disconnect();
			}
		}
	}

	private updateStatusBar(text: string) {
		if (this.statusBarEl) {
			this.statusBarEl.setText(`SyncIt: ${text}`);
		}
	}

	async openSidebarView() {
		const { workspace } = this.app;
		const leaves = workspace.getLeavesOfType(SYNC_SIDEBAR_VIEW_TYPE);

		if (leaves.length > 0) {
			workspace.revealLeaf(leaves[0]);
			return;
		}

		const leaf = workspace.getRightLeaf(false);
		if (leaf) {
			await leaf.setViewState({ type: SYNC_SIDEBAR_VIEW_TYPE, active: true });
			workspace.revealLeaf(leaf);
		}
	}

	private async restoreSidebarView() {
		const { workspace } = this.app;
		const leaves = workspace.getLeavesOfType(SYNC_SIDEBAR_VIEW_TYPE);
		if (leaves.length === 0) {
			// Sidebar wasn't open previously
			return;
		}
		// Reveal if it was open
		for (const leaf of leaves) {
			workspace.revealLeaf(leaf);
		}
	}

	async checkForUpdates(manual: boolean) {
		if (!this._updater) return;

		try {
			const result = await this._updater.checkForUpdate(
				this.manifest.version,
				this.settings.updateChannel === "dev",
				(this.manifest as any).commitHash,  // commit hash from build
				(this.manifest as any).buildBranch ?? "main",
			);

			this.settings.lastUpdateCheck = Date.now();
			await this.saveSettings();

			if (!result.hasUpdate) {
				if (manual) {
					if (result.commitMatch) {
						new Notice("SyncIt: Already on latest dev build");
					} else {
						new Notice("SyncIt: No updates available");
					}
				}
				return;
			}

			// Auto-update stable if enabled
			if (this.settings.autoUpdate && !result.isPrerelease) {
				const tempDir = await this._updater.downloadUpdate(result.release!);
				await this._updater.installUpdate(tempDir);
				new Notice("✅ SyncIt updated. Reloading…");
				// @ts-ignore
				this.app.commands.executeCommandById("app:reload");
				return;
			}

			// Show modal for manual confirmation
			const modal = new UpdateAvailableModal(this.app, result, async () => {
				const tempDir = await this._updater!.downloadUpdate(result.release!);
				await this._updater!.installUpdate(tempDir);
			});
			modal.open();
		} catch (error) {
			console.error("SyncIt update check failed:", error);
			const msg = error instanceof Error ? error.message : String(error);
			if (manual) {
				new Notice(`SyncIt: Update check failed — ${msg}`, 8000);
			}
		}
	}
}
