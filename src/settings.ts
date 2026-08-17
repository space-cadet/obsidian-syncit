import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type SyncItPlugin from "./main";

export class SyncItSettingTab extends PluginSettingTab {
	plugin: SyncItPlugin;

	constructor(app: App, plugin: SyncItPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl("h2", { text: "SyncIt Settings" });

		// WebDAV URL
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

		// Username
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

		// Password
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

		// Remote base directory
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

		// Test connection button
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

		// Exclude patterns
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

		// Safety settings
		containerEl.createEl("h3", { text: "Safety" });

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

		// Performance settings
		containerEl.createEl("h3", { text: "Performance" });

		new Setting(containerEl)
			.setName("Concurrency limit")
			.setDesc("Maximum number of files to sync simultaneously. Higher = faster but more server load. (Default: 3)")
			.addSlider((slider) =>
				slider
					.setLimits(1, 10, 1)
					.setValue(this.plugin.settings.concurrencyLimit)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.concurrencyLimit = value;
						await this.plugin.saveSettings();
					})
			);

		// Updater settings
		containerEl.createEl("h3", { text: "Updates" });

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

		// Version info + manual check
		const versionRow = containerEl.createEl("div", { cls: "setting-item" });
		const versionInfo = versionRow.createEl("div", { cls: "setting-item-info" });
		versionInfo.createEl("div", { cls: "setting-item-name", text: "Current version" });
		const channelLabel = this.plugin.settings.updateChannel === "dev" ? " (dev channel)" : " (stable)";
		versionInfo.createEl("div", {
			cls: "setting-item-description",
			text: `${this.plugin.manifest.version}${channelLabel}`,
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
			const date = new Date(this.plugin.settings.lastUpdateCheck).toLocaleString();
			lastCheck.textContent = `Last checked: ${date}`;
		}

		// Sync button
		containerEl.createEl("h3", { text: "Actions" });

		new Setting(containerEl)
			.setName("Sync now")
			.setDesc("Manually trigger a sync")
			.addButton((button) =>
				button
					.setButtonText("Sync Now")
					.setCta()
					.onClick(() => {
						this.plugin.performSync();
					})
			);
	}
}
