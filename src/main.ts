import { App, Notice, Plugin, Platform, TFile } from "obsidian";
import type { SyncItSettings } from "./types";
import { DEFAULT_SETTINGS } from "./types";
import { SyncItSettingTab } from "./settings";
import { WebDAVAdapter } from "./remote/WebDAVAdapter";
import { VaultScanner } from "./local/VaultScanner";
import { SyncPlanBuilder } from "./sync/SyncPlan";
import { PluginUpdater, UpdateAvailableModal } from "./updater/PluginUpdater";

export default class SyncItPlugin extends Plugin {
	settings: SyncItSettings = DEFAULT_SETTINGS;
	private adapter: WebDAVAdapter | null = null;
	private scanner: VaultScanner | null = null;
	private isSyncing = false;
	private statusBarEl: HTMLSpanElement | null = null;
	private _updater: PluginUpdater | null = null;

	async onload() {
		console.info(`Loading SyncIt plugin`);

		await this.loadSettings();

		this.adapter = new WebDAVAdapter();
		this.scanner = new VaultScanner(this.app, this.settings);

		// Ribbon icon
		this.addRibbonIcon("sync", "SyncIt: Sync vault", () => {
			this.performSync();
		});

		// Command
		this.addCommand({
			id: "syncit-sync",
			name: "Sync vault now",
			callback: () => this.performSync(),
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
		new Notice("SyncIt: Starting sync...");

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

			// Build and execute sync plan
			const builder = new SyncPlanBuilder(this.scanner!, this.adapter!);
			const plan = await builder.buildPlan();

			const totalOps = plan.uploads.length + plan.downloads.length + plan.conflicts.length;

			if (totalOps === 0) {
				new Notice("SyncIt: Already up to date");
				this.updateStatusBar("Up to date");
				return;
			}

			const result = await builder.executePlan(plan, (current, total, operation, path) => {
				this.updateStatusBar(`${operation} ${current}/${total}`);
			});

			// Report results
			const messages: string[] = [];
			if (result.uploaded > 0) messages.push(`${result.uploaded} uploaded`);
			if (result.downloaded > 0) messages.push(`${result.downloaded} downloaded`);
			if (result.conflicts > 0) messages.push(`${result.conflicts} conflicts resolved`);
			if (result.errors.length > 0) messages.push(`${result.errors.length} errors`);

			const msg = messages.join(", ") || "Nothing to sync";
			new Notice(`SyncIt: ${msg}`);
			this.updateStatusBar(`Last sync: ${new Date().toLocaleTimeString()}`);

			if (result.errors.length > 0) {
				console.error("SyncIt errors:", result.errors);
			}
		} catch (error) {
			console.error("SyncIt sync failed:", error);
			new Notice(`SyncIt: Sync failed — ${error instanceof Error ? error.message : error}`, 10000);
			this.updateStatusBar("Sync failed");
		} finally {
			this.isSyncing = false;
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
