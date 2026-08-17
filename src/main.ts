import { App, Notice, Plugin, Platform, TFile, WorkspaceLeaf } from "obsidian";
import type { SyncItSettings } from "./types";
import { DEFAULT_SETTINGS } from "./types";
import { SyncItSettingTab } from "./settings";
import { WebDAVAdapter } from "./remote/WebDAVAdapter";
import { VaultScanner } from "./local/VaultScanner";
import { SyncPlanBuilder, SyncCancelledError } from "./sync/SyncPlan";
import { PluginUpdater, UpdateAvailableModal } from "./updater/PluginUpdater";
import { SyncProgressModal } from "./ui/SyncProgressModal";
import { SyncSidebarView, SYNC_SIDEBAR_VIEW_TYPE } from "./ui/SyncSidebarView";

export default class SyncItPlugin extends Plugin {
	settings: SyncItSettings = DEFAULT_SETTINGS;
	private adapter: WebDAVAdapter | null = null;
	private scanner: VaultScanner | null = null;
	private isSyncing = false;
	private statusBarEl: HTMLSpanElement | null = null;
	private _updater: PluginUpdater | null = null;
	private _sidebarView: SyncSidebarView | null = null;

	async onload() {
		console.info(`Loading SyncIt plugin`);

		await this.loadSettings();

		this.adapter = new WebDAVAdapter();
		this.scanner = new VaultScanner(this.app, this.settings);

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
	}

	async performSync() {
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
		new Notice("SyncIt: Starting sync...");

		// Create progress modal
		const progressModal = new SyncProgressModal(this.app);
		let modalClosed = false;
		progressModal.onCancel = () => {
			modalClosed = true;
		};
		progressModal.open();

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

			// Build sync plan
			const builder = new SyncPlanBuilder(this.scanner!, this.adapter!);
			const plan = await builder.buildPlan();

			// Pass plan to modal for pre-sync summary
			progressModal.setPlan(plan);

			const totalOps = plan.uploads.length + plan.downloads.length + plan.conflicts.length;

			if (totalOps === 0) {
				progressModal.finish({
					uploaded: 0,
					downloaded: 0,
					deleted: 0,
					conflicts: 0,
					skipped: 0,
					errors: [],
					message: "Already up to date",
				});
				this.updateStatusBar("Up to date");
				this._sidebarView?.updateStatus("Up to date", "Just now");
				return;
			}

			progressModal.setTotal(totalOps);

			// Execute plan with progress tracking
			const result = await builder.executePlan(
				plan,
				this.settings.concurrencyLimit,
				(current, total, operation, path) => {
					if (!modalClosed) {
						const opType = operation.includes("upload") ? "upload" :
							operation.includes("download") ? "download" :
							operation.includes("conflict") ? "conflict" : "system";
						// Look up file size from the plan
						const uploadFile = plan.uploads.find(f => f.path === path);
						const downloadFile = plan.downloads.find(f => f.path === path);
						const conflict = plan.conflicts.find(c => c.local.path === path || c.remote.path === path);
						let size = uploadFile?.size ?? downloadFile?.size ?? 0;
						if (conflict) {
							size = operation.includes("upload")
								? conflict.local.size
								: conflict.remote.size;
						}
						progressModal.addLog(opType, path, { done: true, size });
					}
					this.updateStatusBar(`${operation} ${current}/${total}`);
				},
				() => modalClosed,
			);

			// Report results
			const messages: string[] = [];
			if (result.uploaded > 0) messages.push(`${result.uploaded} uploaded`);
			if (result.downloaded > 0) messages.push(`${result.downloaded} downloaded`);
			if (result.conflicts > 0) messages.push(`${result.conflicts} conflicts resolved`);
			if (result.errors.length > 0) messages.push(`${result.errors.length} errors`);

			const msg = messages.join(", ") || "Nothing to sync";
			const fullResult = {
				...result,
				message: msg,
			};

			if (!modalClosed) {
				progressModal.finish(fullResult);
			}

			new Notice(`SyncIt: ${msg}`);
			const timeStr = new Date().toLocaleTimeString();
			this.updateStatusBar(`Last sync: ${timeStr}`);
			this._sidebarView?.updateStatus("Ready", timeStr);

			if (result.errors.length > 0) {
				console.error("SyncIt errors:", result.errors);
			}
		} catch (error) {
			if (error instanceof SyncCancelledError) {
				new Notice("SyncIt: Sync cancelled");
				this.updateStatusBar("Sync cancelled");
				this._sidebarView?.updateStatus("Cancelled");
				if (!modalClosed) {
					progressModal.addLog("system", "Sync cancelled by user");
					progressModal.finish({
						uploaded: 0,
						downloaded: 0,
						deleted: 0,
						conflicts: 0,
						skipped: 0,
						errors: [],
						message: "Cancelled",
					});
				}
				return;
			}
			console.error("SyncIt sync failed:", error);
			const errorMsg = error instanceof Error ? error.message : String(error);
			if (!modalClosed) {
				progressModal.addLog("error", `Sync failed: ${errorMsg}`, { error: true });
			}
			new Notice(`SyncIt: Sync failed — ${errorMsg}`, 10000);
			this.updateStatusBar("Sync failed");
			this._sidebarView?.updateStatus("Sync failed");
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
			);

			this.settings.lastUpdateCheck = Date.now();
			await this.saveSettings();

			if (!result.hasUpdate) {
				if (manual) {
					new Notice("SyncIt: No updates available");
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
			if (manual) {
				new Notice("SyncIt: Update check failed");
			}
		}
	}
}
