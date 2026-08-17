import { ItemView, WorkspaceLeaf, Notice } from "obsidian";
import type SyncItPlugin from "../main";

export const SYNC_SIDEBAR_VIEW_TYPE = "syncit-sidebar";

export class SyncSidebarView extends ItemView {
	private plugin: SyncItPlugin;
	statusEl!: HTMLElement;
	lastSyncEl!: HTMLElement;
	syncBtn!: HTMLElement;
	settingsBtn!: HTMLElement;

	constructor(leaf: WorkspaceLeaf, plugin: SyncItPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return SYNC_SIDEBAR_VIEW_TYPE;
	}

	getDisplayText(): string {
		return "SyncIt";
	}

	getIcon(): string {
		return "sync";
	}

	async onOpen() {
		const container = this.containerEl.children[1];
		container.empty();
		container.addClass("syncit-sidebar");

		// Header
		const header = container.createDiv("syncit-sidebar-header");
		header.style.padding = "12px 16px";
		header.style.borderBottom = "1px solid var(--background-modifier-border)";
		header.style.display = "flex";
		header.style.alignItems = "center";
		header.style.gap = "8px";

		const icon = header.createEl("span");
		icon.setText("🔄");
		icon.style.fontSize = "1.2em";

		const title = header.createEl("h3");
		title.setText("SyncIt");
		title.style.margin = "0";
		title.style.fontSize = "1.1em";
		title.style.fontWeight = "600";

		// Status section
		const statusSection = container.createDiv("syncit-sidebar-status");
		statusSection.style.padding = "12px 16px";
		statusSection.style.borderBottom = "1px solid var(--background-modifier-border)";

		const statusLabel = statusSection.createEl("div");
		statusLabel.style.fontSize = "0.85em";
		statusLabel.style.color = "var(--text-muted)";
		statusLabel.setText("Status");

		this.statusEl = statusSection.createEl("div");
		this.statusEl.style.fontWeight = "500";
		this.statusEl.style.marginTop = "4px";
		this.statusEl.setText("Ready");

		this.lastSyncEl = statusSection.createEl("div");
		this.lastSyncEl.style.fontSize = "0.8em";
		this.lastSyncEl.style.color = "var(--text-muted)";
		this.lastSyncEl.style.marginTop = "4px";
		this.lastSyncEl.setText("Never synced");

		// Actions section
		const actionsSection = container.createDiv("syncit-sidebar-actions");
		actionsSection.style.padding = "12px 16px";
		actionsSection.style.display = "flex";
		actionsSection.style.flexDirection = "column";
		actionsSection.style.gap = "8px";

		// Sync button
		this.syncBtn = actionsSection.createEl("button", { text: "Sync Now" });
		this.syncBtn.addClass("mod-cta");
		this.syncBtn.style.width = "100%";
		this.syncBtn.addEventListener("click", () => {
			this.plugin.performSync();
		});

		// Settings button
		this.settingsBtn = actionsSection.createEl("button", { text: "Settings" });
		this.settingsBtn.style.width = "100%";
		this.settingsBtn.addEventListener("click", () => {
			// @ts-ignore
			this.app.setting.open();
			// @ts-ignore
			this.app.setting.openTabById(this.plugin.manifest.id);
		});

		// Connection info
		const infoSection = container.createDiv("syncit-sidebar-info");
		infoSection.style.padding = "12px 16px";
		infoSection.style.fontSize = "0.8em";
		infoSection.style.color = "var(--text-muted)";
		infoSection.style.borderTop = "1px solid var(--background-modifier-border)";
		infoSection.style.marginTop = "auto";

		const url = this.plugin.settings.webdavUrl || "Not configured";
		infoSection.createEl("div", { text: `Server: ${url}` });
	}

	updateStatus(status: string, lastSync?: string) {
		if (this.statusEl) {
			this.statusEl.setText(status);
		}
		if (this.lastSyncEl && lastSync) {
			this.lastSyncEl.setText(`Last sync: ${lastSync}`);
		}
	}

	setSyncing(syncing: boolean) {
		if (this.syncBtn) {
			(this.syncBtn as HTMLButtonElement).disabled = syncing;
			this.syncBtn.setText(syncing ? "Syncing..." : "Sync Now");
		}
		if (syncing) {
			this.updateStatus("Syncing...");
		}
	}

	async onClose() {
		// Nothing to clean up
	}
}
