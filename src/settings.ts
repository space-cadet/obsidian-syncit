import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type SyncItPlugin from "./main";

type SettingsSection = {
	id: string;
	title: string;
	description?: string;
};

const SECTIONS: SettingsSection[] = [
	{ id: "sync-behavior", title: "Sync Behavior" },
	{ id: "connection", title: "WebDAV Connection" },
	{ id: "safety", title: "Safety" },
	{ id: "performance", title: "Performance" },
	{ id: "logging", title: "Logging" },
	{ id: "updates", title: "Updates" },
];

export class SyncItSettingTab extends PluginSettingTab {
	plugin: SyncItPlugin;

	constructor(app: App, plugin: SyncItPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		// ── Title ──
		containerEl.createEl("h2", { text: "SyncIt Settings" });
		containerEl.createEl("p", {
			text: "Configure the server once, then choose how each sync should move files.",
			cls: "setting-item-description",
		});

		// ── Table of Contents ──
		this.renderToC(containerEl);

		// ── Sections ──
		this.renderSyncBehavior(containerEl);
		this.renderConnection(containerEl);
		this.renderSafety(containerEl);
		this.renderPerformance(containerEl);
		this.renderLogging(containerEl);
		this.renderUpdates(containerEl);
	}

	// ═══════════════════════════════════════
	//  Table of Contents
	// ═══════════════════════════════════════

	private renderToC(containerEl: HTMLElement) {
		const toc = containerEl.createEl("nav", { cls: "syncit-settings-toc" });
		toc.style.padding = "8px 0 12px";
		toc.style.marginBottom = "12px";
		toc.style.borderBottom = "1px solid var(--background-modifier-border)";

		const tocTitle = toc.createEl("div");
		tocTitle.style.fontWeight = "600";
		tocTitle.style.fontSize = "0.85em";
		tocTitle.style.marginBottom = "6px";
		tocTitle.style.color = "var(--text-muted)";
		tocTitle.setText("Jump to");

		const tocList = toc.createEl("div");
		tocList.style.display = "flex";
		tocList.style.flexWrap = "wrap";
		tocList.style.gap = "4px";

		for (const section of SECTIONS) {
			const link = tocList.createEl("a", {
				href: `#${section.id}`,
				text: section.title,
			});
			link.style.padding = "2px 8px";
			link.style.fontSize = "0.75em";
			link.style.borderRadius = "10px";
			link.style.background = "var(--background-primary-alt)";
			link.style.color = "var(--text-muted)";
			link.style.textDecoration = "none";
			link.style.border = "1px solid var(--background-modifier-border)";
			link.style.transition = "all 0.15s ease";

			link.addEventListener("mouseenter", () => {
				link.style.background = "var(--interactive-accent)";
				link.style.color = "var(--text-on-accent)";
				link.style.borderColor = "var(--interactive-accent)";
			});
			link.addEventListener("mouseleave", () => {
				link.style.background = "var(--background-primary-alt)";
				link.style.color = "var(--text-muted)";
				link.style.borderColor = "var(--background-modifier-border)";
			});
			link.addEventListener("click", (e) => {
				e.preventDefault();
				const target = containerEl.querySelector(`#${section.id}`);
				target?.scrollIntoView({ behavior: "smooth", block: "start" });
			});
		}
	}

	// ═══════════════════════════════════════
	//  Sync Behavior
	// ═══════════════════════════════════════

	private renderSyncBehavior(containerEl: HTMLElement) {
		this.sectionHeader(containerEl, "sync-behavior", "Sync Behavior");

		new Setting(containerEl)
			.setName("Default sync direction")
			.setDesc("The direction used by the sidebar Sync button and commands.")
			.addDropdown((dropdown) => {
				dropdown.selectEl.addClass("syncit-dropdown");
				dropdown
					.addOption("two-way", "↕ Two-way — upload and download")
					.addOption("upload-only", "↑ Upload only — send local changes")
					.addOption("download-only", "↓ Download only — receive remote changes")
					.setValue(this.plugin.settings.syncDirection)
					.onChange(async (value) => {
						this.plugin.settings.syncDirection = value as "two-way" | "upload-only" | "download-only";
						await this.plugin.saveSettings();
						this.plugin.refreshSidebarMode();
					});
			});

		new Setting(containerEl)
			.setName("When reconciliation is needed")
			.setDesc("Upload/download-only modes resolve in that direction. Two-way sync still shows review when files are ambiguous.")
			.addDropdown((dropdown) => {
				dropdown.selectEl.addClass("syncit-dropdown");
				dropdown
					.addOption("follow-direction", "Follow sync direction")
					.addOption("prompt", "Always prompt for review")
					.setValue(this.plugin.settings.reconciliationPolicy)
					.onChange(async (value) => {
						this.plugin.settings.reconciliationPolicy = value as "follow-direction" | "prompt";
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("When downloading, local files not on remote")
			.setDesc("What to do with local files that don't exist on the server during download-only sync.")
			.addDropdown((dropdown) => {
				dropdown.selectEl.addClass("syncit-dropdown");
				dropdown
					.addOption("keep", "Keep local files")
					.addOption("delete-local", "Delete local files (mirror)")
					.setValue(this.plugin.settings.downloadOrphanPolicy)
					.onChange(async (value) => {
						this.plugin.settings.downloadOrphanPolicy = value as "keep" | "delete-local";
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("When uploading, remote files not local")
			.setDesc("What to do with remote files that don't exist locally during upload-only sync.")
			.addDropdown((dropdown) => {
				dropdown.selectEl.addClass("syncit-dropdown");
				dropdown
					.addOption("keep", "Keep remote files")
					.addOption("delete-remote", "Delete remote files (mirror)")
					.setValue(this.plugin.settings.uploadOrphanPolicy)
					.onChange(async (value) => {
						this.plugin.settings.uploadOrphanPolicy = value as "keep" | "delete-remote";
						await this.plugin.saveSettings();
					});
			});
	}

	// ═══════════════════════════════════════
	//  WebDAV Connection
	// ═══════════════════════════════════════

	private renderConnection(containerEl: HTMLElement) {
		this.sectionHeader(containerEl, "connection", "WebDAV Connection");

		new Setting(containerEl)
			.setName("WebDAV URL")
			.setDesc("Your WebDAV server URL (e.g., https://nextcloud.example.com/remote.php/dav/files/username/)")
			.addText((text) =>
				text
					.setPlaceholder("https://...")
					.setValue(this.plugin.settings.webdavUrl)
					.onChange(async (value) => {
						this.plugin.settings.webdavUrl = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Username")
			.setDesc("WebDAV username")
			.addText((text) =>
				text
					.setPlaceholder("username")
					.setValue(this.plugin.settings.webdavUsername)
					.onChange(async (value) => {
						this.plugin.settings.webdavUsername = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Password")
			.setDesc("WebDAV password")
			.addText((text) => {
				text
					.setPlaceholder("password")
					.setValue(this.plugin.settings.webdavPassword)
					.onChange(async (value) => {
						this.plugin.settings.webdavPassword = value;
						await this.plugin.saveSettings();
					});
				text.inputEl.type = "password";
			});

		new Setting(containerEl)
			.setName("Remote base directory")
			.setDesc("Directory on the WebDAV server to store synced files (leave empty for vault name)")
			.addText((text) =>
				text
					.setPlaceholder("obsidian-syncit")
					.setValue(this.plugin.settings.remoteBaseDir)
					.onChange(async (value) => {
						this.plugin.settings.remoteBaseDir = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Test connection")
			.setDesc("Verify WebDAV connection")
			.addButton((button) =>
				button
					.setButtonText("Test")
					.onClick(async () => {
						button.setDisabled(true);
						button.setButtonText("Testing...");
						const result = await this.plugin.testConnection();
						button.setDisabled(false);
						button.setButtonText("Test");
						if (result.success) {
							new Notice(`SyncIt: ✅ ${result.message}`);
						} else {
							new Notice(`SyncIt: ❌ ${result.message}`, 10000);
						}
					})
			);

		new Setting(containerEl)
			.setName("Exclude patterns")
			.setDesc("Files/directories to exclude from sync (one per line)")
			.addTextArea((text) => {
				text
					.setPlaceholder(".obsidian/\n.git/\n.trash/")
					.setValue(this.plugin.settings.excludePatterns.join("\n"))
					.onChange(async (value) => {
						this.plugin.settings.excludePatterns = value
							.split("\n")
							.map((s) => s.trim())
							.filter((s) => s.length > 0);
						await this.plugin.saveSettings();
					});
				text.inputEl.rows = 5;
			});

		new Setting(containerEl)
			.setName("Include hidden paths")
			.setDesc("Obsidian-hidden paths to include in sync (one per line). Must be under .obsidian/. Blocked file types are never synced.")
			.addTextArea((text) => {
				text
					.setPlaceholder(".obsidian/plugins/obsidian-ai/sessions/")
					.setValue(this.plugin.settings.includePatterns.join("\n"))
					.onChange(async (value) => {
						const raw = value
							.split("\n")
							.map((s) => s.trim())
							.filter((s) => s.length > 0);

						// Validate each pattern
						const { HiddenPathScanner } = await import("./local/HiddenPathScanner");
						const scanner = new HiddenPathScanner(this.app, raw);
						const invalid: string[] = [];
						for (const p of raw) {
							const err = scanner.validatePattern(p);
							if (err) invalid.push(`• "${p}": ${err}`);
						}

						this.plugin.settings.includePatterns = raw;
						await this.plugin.saveSettings();

						if (invalid.length > 0) {
							new Notice(`SyncIt: Invalid include patterns:\n${invalid.join("\n")}`, 8000);
						}
					});
				text.inputEl.rows = 4;
			});

		// Warning about safety blocklist
		const blocklistWarning = containerEl.createEl("div", {
			cls: "setting-item-description",
		});
		blocklistWarning.style.color = "var(--text-warning)";
		blocklistWarning.style.fontSize = "0.8em";
		blocklistWarning.style.marginTop = "-8px";
		blocklistWarning.style.marginBottom = "12px";
		blocklistWarning.innerHTML = `
			<strong>Safety blocklist (never synced):</strong>
			.js, .css, .mjs, .tmp, .bak, manifest.json, data.json, hot-reload.json
		`;
	}

	// ═══════════════════════════════════════
	//  Safety
	// ═══════════════════════════════════════

	private renderSafety(containerEl: HTMLElement) {
		this.sectionHeader(containerEl, "safety", "Safety");

		new Setting(containerEl)
			.setName("Move to trash")
			.setDesc("Move deleted files to system trash instead of permanently deleting them")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.moveToTrash)
					.onChange(async (value) => {
						this.plugin.settings.moveToTrash = value;
						await this.plugin.saveSettings();
					})
			);
	}

	// ═══════════════════════════════════════
	//  Performance
	// ═══════════════════════════════════════

	private renderPerformance(containerEl: HTMLElement) {
		this.sectionHeader(containerEl, "performance", "Performance");

		const concurrencySetting = new Setting(containerEl)
			.setName("Concurrency limit")
			.setDesc(`Maximum files to sync simultaneously. Higher = faster but more server load. Current: ${this.plugin.settings.concurrencyLimit}`)
			.addSlider((slider) =>
				slider
					.setLimits(1, 10, 1)
					.setValue(this.plugin.settings.concurrencyLimit)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.concurrencyLimit = value;
						concurrencySetting.setDesc(`Maximum files to sync simultaneously. Higher = faster but more server load. Current: ${value}`);
						await this.plugin.saveSettings();
					})
			);
	}

	// ═══════════════════════════════════════
	//  Logging
	// ═══════════════════════════════════════

	private renderLogging(containerEl: HTMLElement) {
		this.sectionHeader(containerEl, "logging", "Logging");

		containerEl.createEl("p", {
			text: "Logs are stored in .syncit/log.jsonl in your vault. Optionally keep a backup in the plugin directory.",
			cls: "setting-item-description",
		});

		new Setting(containerEl)
			.setName("Log level")
			.setDesc("How much detail to record. ERROR = failures only, DEBUG = everything.")
			.addDropdown((dropdown) => {
				dropdown.selectEl.addClass("syncit-dropdown");
				dropdown
					.addOption("ERROR", "ERROR — Failures only")
					.addOption("WARNING", "WARNING — + skipped files, suspicious conditions")
					.addOption("INFO", "INFO — + per-file operations (default)")
					.addOption("DEBUG", "DEBUG — + dry-run details, hashes, decisions")
					.setValue(this.plugin.settings.logLevel)
					.onChange(async (value) => {
						this.plugin.settings.logLevel = value as "ERROR" | "WARNING" | "INFO" | "DEBUG";
						await this.plugin.saveSettings();
						await this.plugin.logger?.updateSettings({ minLevel: this.plugin.settings.logLevel });
					});
			});

		const maxAgeSetting = new Setting(containerEl)
			.setName("Max log age")
			.setDesc(`Automatically purge log entries older than this many days. Current: ${this.plugin.settings.logMaxAgeDays} days`)
			.addSlider((slider) =>
				slider
					.setLimits(1, 90, 1)
					.setValue(this.plugin.settings.logMaxAgeDays)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.logMaxAgeDays = value;
						maxAgeSetting.setDesc(`Automatically purge log entries older than this many days. Current: ${value} days`);
						await this.plugin.saveSettings();
						await this.plugin.logger?.updateSettings({ maxAgeDays: value });
					})
			);

		const maxSizeSetting = new Setting(containerEl)
			.setName("Max log size")
			.setDesc(`Rotate log when it exceeds this size in MB. Older entries are purged first. Current: ${this.plugin.settings.logMaxSizeMB} MB`)
			.addSlider((slider) =>
				slider
					.setLimits(1, 100, 1)
					.setValue(this.plugin.settings.logMaxSizeMB)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.logMaxSizeMB = value;
						maxSizeSetting.setDesc(`Rotate log when it exceeds this size in MB. Older entries are purged first. Current: ${value} MB`);
						await this.plugin.saveSettings();
						await this.plugin.logger?.updateSettings({ maxSizeMB: value });
					})
			);

		new Setting(containerEl)
			.setName("Backup log in plugin directory")
			.setDesc("Keep a copy of the log in .obsidian/plugins/obsidian-syncit/ (survives vault sync, removed on uninstall)")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.logBackupInPluginDir)
					.onChange(async (value) => {
						this.plugin.settings.logBackupInPluginDir = value;
						await this.plugin.saveSettings();
						await this.plugin.logger?.updateSettings({ keepBackup: value });
					})
			);
	}

	// ═══════════════════════════════════════
	//  Updates
	// ═══════════════════════════════════════

	private renderUpdates(containerEl: HTMLElement) {
		this.sectionHeader(containerEl, "updates", "Updates");

		new Setting(containerEl)
			.setName("Check for updates on startup")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.checkForUpdates)
					.onChange(async (value) => {
						this.plugin.settings.checkForUpdates = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Release channel")
			.setDesc("Stable releases are tested. Dev builds include latest features but may be less stable.")
			.addDropdown((dropdown) =>
				dropdown
					.addOption("stable", "Stable")
					.addOption("dev", "Dev (pre-release)")
					.setValue(this.plugin.settings.updateChannel)
					.onChange(async (value) => {
						this.plugin.settings.updateChannel = value as "stable" | "dev";
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Auto-install stable updates")
			.setDesc("Automatically install stable updates without prompting. Dev builds always require confirmation.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.autoUpdate)
					.onChange(async (value) => {
						this.plugin.settings.autoUpdate = value;
						await this.plugin.saveSettings();
						if (value) {
							new Notice("Auto-update enabled. Stable updates will install silently.");
						}
					}),
			);

		// Version info
		this.sectionHeader(containerEl, "version-info", "Version", "h4");

		const versionRow = containerEl.createEl("div", { cls: "setting-item" });
		const versionInfo = versionRow.createEl("div", { cls: "setting-item-info" });
		versionInfo.createEl("div", { cls: "setting-item-name", text: "Current version" });

		const manifest = this.plugin.manifest as any;
		const channelLabel = this.plugin.settings.updateChannel === "dev" ? " (dev channel)" : " (stable)";
		let versionDesc = `${this.plugin.manifest.version}${channelLabel}`;

		if (manifest.commitHash) {
			versionDesc += ` · ${manifest.commitHash.slice(0, 7)}`;
		}
		if (manifest.buildBranch) {
			versionDesc += ` · branch: ${manifest.buildBranch}`;
		}
		if (manifest.buildDate) {
			versionDesc += ` · ${new Date(manifest.buildDate).toLocaleDateString()}`;
		}

		versionInfo.createEl("div", {
			cls: "setting-item-description",
			text: versionDesc,
		});

		const btnControl = versionRow.createEl("div", { cls: "setting-item-control" });
		const checkBtn = btnControl.createEl("button", { text: "Check Now", cls: "mod-cta" });
		checkBtn.addEventListener("click", async () => {
			checkBtn.setText("Checking…");
			checkBtn.disabled = true;
			await this.plugin.checkForUpdates(true);
			checkBtn.setText("Check Now");
			checkBtn.disabled = false;
		});

		if (this.plugin.settings.lastUpdateCheck > 0) {
			const lastCheck = containerEl.createEl("p", { cls: "setting-item-description" });
			lastCheck.textContent = `Last checked: ${new Date(this.plugin.settings.lastUpdateCheck).toLocaleString()}`;
		}

		new Setting(containerEl)
			.setName("Available branch builds")
			.setDesc("Browse and install published development builds from any branch.")
			.addButton((button) => button
				.setButtonText("Browse builds")
				.onClick(() => this.plugin.showAvailableBuilds()));
	}



	private sectionHeader(
		containerEl: HTMLElement,
		id: string,
		title: string,
		tag: "h3" | "h4" = "h3",
	) {
		const el = containerEl.createEl(tag, { text: title });
		el.id = id;
		el.style.scrollMarginTop = "60px"; // space for sticky ToC
		return el;
	}
}
