import { ItemView, WorkspaceLeaf } from "obsidian";
import type SyncItPlugin from "../main";
import type { SyncPlan, SyncResult, FileEntity } from "../types";

export const SYNC_SIDEBAR_VIEW_TYPE = "syncit-sidebar";

export class SyncSidebarView extends ItemView {
	private plugin: SyncItPlugin;

	// Idle UI
	statusEl!: HTMLElement;
	lastSyncEl!: HTMLElement;
	syncBtn!: HTMLElement;
	settingsBtn!: HTMLElement;

	// Progress UI (created dynamically)
	private progressSection: HTMLElement | null = null;
	private progressFillEl: HTMLElement | null = null;
	private progressPercentEl: HTMLElement | null = null;
	private statEls: Map<string, { valueEl: HTMLElement; labelEl: HTMLElement }> = new Map();
	private fileLogEl: HTMLElement | null = null;
	private cancelBtn: HTMLElement | null = null;
	private completionSection: HTMLElement | null = null;

	// State
	private isSyncing = false;
	private startTime = 0;
	private totalOps = 0;
	private completedOps = 0;
	private scanned = 0;
	private uploaded = 0;
	private skipped = 0;
	private overwritten = 0;
	private conflicts = 0;
	private currentPlan: SyncPlan | null = null;

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
		const container = this.containerEl.children[1] as HTMLElement;
		container.empty();
		container.addClass("syncit-sidebar");
		container.style.display = "flex";
		container.style.flexDirection = "column";
		container.style.height = "100%";

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

		// Status section (always visible)
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

		// Spacer to push connection info down
		const spacer = container.createDiv();
		spacer.style.flex = "1";

		// Connection info
		const infoSection = container.createDiv("syncit-sidebar-info");
		infoSection.style.padding = "12px 16px";
		infoSection.style.fontSize = "0.8em";
		infoSection.style.color = "var(--text-muted)";
		infoSection.style.borderTop = "1px solid var(--background-modifier-border)";

		const url = this.plugin.settings.webdavUrl || "Not configured";
		infoSection.createEl("div", { text: `Server: ${url}` });
	}

	// ─── Progress API ───

	/** Called before sync starts with the plan. */
	setPlan(plan: SyncPlan) {
		this.isSyncing = true;
		this.startTime = Date.now();
		this.totalOps = plan.uploads.length + plan.downloads.length + plan.conflicts.length;
		this.completedOps = 0;
		this.scanned = plan.uploads.length + plan.downloads.length + plan.conflicts.length + plan.unchanged;
		this.uploaded = 0;
		this.skipped = plan.unchanged;
		this.overwritten = 0;
		this.conflicts = 0;
		this.currentPlan = plan;

		this.statusEl.setText("Syncing...");
		this.lastSyncEl.setText(`${this.scanned} scanned · ${this.totalOps} to sync`);

		this._removeCompletionUI();
		this.syncBtn.style.display = "none";
		this._ensureProgressUI();
		this._updateProgressBar();
		this._updateStats();
	}

	/** Called for each completed operation. */
	updateProgress(current: number, total: number, operation: string, path: string) {
		this.completedOps = current;
		this._updateProgressBar();

		const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1);
		this.lastSyncEl.setText(`${current} of ${total} files · ${elapsed}s`);

		// Determine operation type and update counters
		const opType = operation.includes("upload") ? "upload" :
			operation.includes("download") ? "download" :
			operation.includes("conflict") ? "conflict" : "upload";

		if (opType === "upload") this.uploaded++;
		else if (opType === "download") this.overwritten++;
		else if (opType === "conflict") this.conflicts++;

		this._updateStats();

		// Look up size from plan
		let size = 0;
		if (this.currentPlan) {
			const uploadFile = this.currentPlan.uploads.find(f => f.path === path);
			const downloadFile = this.currentPlan.downloads.find(f => f.path === path);
			const conflict = this.currentPlan.conflicts.find(c => c.local.path === path || c.remote.path === path);
			size = uploadFile?.size ?? downloadFile?.size ?? 0;
			if (conflict) {
				size = operation.includes("upload") ? conflict.local.size : conflict.remote.size;
			}
		}

		this._addFileLogEntry(path, opType, { size });
	}

	/** Called when sync finishes. */
	finish(result: SyncResult & { message: string }) {
		this.isSyncing = false;
		const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1);

		this.statusEl.setText("Ready");
		this.lastSyncEl.setText(`${result.message} · ${elapsed}s`);

		this._removeProgressUI();
		this._showCompletionSummary(result, elapsed);
		this.syncBtn.style.display = "block";
		(this.syncBtn as HTMLButtonElement).disabled = false;
		this.syncBtn.setText("Sync Now");
	}

	/** Called when sync is cancelled. */
	setCancelled() {
		this.isSyncing = false;
		this.statusEl.setText("Cancelled");
		this.lastSyncEl.setText("Sync was cancelled");

		this._removeProgressUI();
		this._removeCompletionUI();
		this.syncBtn.style.display = "block";
		(this.syncBtn as HTMLButtonElement).disabled = false;
		this.syncBtn.setText("Sync Now");
	}

	/** Called when sync fails. */
	setError(message: string) {
		this.isSyncing = false;
		this.statusEl.setText("Sync failed");
		this.lastSyncEl.setText(message);

		this._removeProgressUI();
		this._removeCompletionUI();
		this.syncBtn.style.display = "block";
		(this.syncBtn as HTMLButtonElement).disabled = false;
		this.syncBtn.setText("Sync Now");
	}

	// ─── Idle State API ───

	updateStatus(status: string, lastSync?: string) {
		if (!this.isSyncing) {
			this.statusEl.setText(status);
			if (lastSync) {
				this.lastSyncEl.setText(`Last sync: ${lastSync}`);
			}
		}
	}

	setSyncing(syncing: boolean) {
		if (!syncing && !this.isSyncing) {
			(this.syncBtn as HTMLButtonElement).disabled = false;
			this.syncBtn.setText("Sync Now");
		}
	}

	// ─── Private UI helpers ───

	private _ensureProgressUI() {
		if (this.progressSection) return;

		const container = this.containerEl.children[1] as HTMLElement;
		const actionsSection = container.querySelector(".syncit-sidebar-actions");
		if (!actionsSection) return;

		// Progress section (insert before actions)
		this.progressSection = container.createDiv("syncit-sidebar-progress-section");
		this.progressSection.style.padding = "0 16px 12px";
		container.insertBefore(this.progressSection, actionsSection);

		// Progress bar
		const progressContainer = this.progressSection.createDiv();
		progressContainer.style.height = "6px";
		progressContainer.style.background = "var(--background-modifier-border)";
		progressContainer.style.borderRadius = "3px";
		progressContainer.style.marginBottom = "6px";
		progressContainer.style.overflow = "hidden";

		this.progressFillEl = progressContainer.createDiv();
		this.progressFillEl.style.height = "100%";
		this.progressFillEl.style.width = "0%";
		this.progressFillEl.style.background = "var(--interactive-accent)";
		this.progressFillEl.style.transition = "width 0.2s ease";
		this.progressFillEl.style.borderRadius = "3px";

		this.progressPercentEl = this.progressSection.createEl("div");
		this.progressPercentEl.style.textAlign = "right";
		this.progressPercentEl.style.fontSize = "0.75em";
		this.progressPercentEl.style.color = "var(--text-muted)";
		this.progressPercentEl.style.marginBottom = "8px";
		this.progressPercentEl.setText("0%");

		// Stats row (rich stat cards like modal)
		const statsRow = this.progressSection.createDiv();
		statsRow.style.display = "flex";
		statsRow.style.justifyContent = "space-around";
		statsRow.style.gap = "4px";
		statsRow.style.marginBottom = "10px";
		statsRow.style.flexWrap = "wrap";

		const statDefs = [
			{ key: "scanned", label: "scanned", color: "var(--text-normal)" },
			{ key: "upload", label: "upload", color: "var(--text-success)" },
			{ key: "skip", label: "skip", color: "var(--text-muted)" },
			{ key: "overwrite", label: "overwrite", color: "var(--text-accent)" },
			{ key: "conflict", label: "conflict", color: "var(--text-warning)" },
		];

		for (const def of statDefs) {
			const card = statsRow.createDiv();
			card.style.textAlign = "center";
			card.style.flex = "1";
			card.style.minWidth = "50px";

			const valueEl = card.createEl("div");
			valueEl.style.fontSize = "1.1em";
			valueEl.style.fontWeight = "700";
			valueEl.style.color = def.color;
			valueEl.setText("0");

			const labelEl = card.createEl("div");
			labelEl.style.fontSize = "0.65em";
			labelEl.style.color = "var(--text-faint)";
			labelEl.setText(def.label);

			this.statEls.set(def.key, { valueEl, labelEl });
		}

		// Cancel button
		this.cancelBtn = this.progressSection.createEl("button", { text: "Cancel", cls: "mod-warning" });
		this.cancelBtn.style.width = "100%";
		this.cancelBtn.addEventListener("click", () => {
			this.plugin.cancelSync();
		});

		// File log
		const logHeader = this.progressSection.createEl("div");
		logHeader.style.fontSize = "0.75em";
		logHeader.style.color = "var(--text-faint)";
		logHeader.style.marginTop = "8px";
		logHeader.style.marginBottom = "4px";
		logHeader.setText("Files");

		this.fileLogEl = this.progressSection.createDiv();
		this.fileLogEl.style.maxHeight = "200px";
		this.fileLogEl.style.overflowY = "auto";
		this.fileLogEl.style.display = "flex";
		this.fileLogEl.style.flexDirection = "column";
		this.fileLogEl.style.gap = "3px";
		this.fileLogEl.style.fontSize = "0.85em";
	}

	private _removeProgressUI() {
		if (this.progressSection) {
			this.progressSection.remove();
			this.progressSection = null;
			this.progressFillEl = null;
			this.progressPercentEl = null;
			this.fileLogEl = null;
			this.cancelBtn = null;
			this.statEls.clear();
		}
	}

	private _showCompletionSummary(result: SyncResult & { message: string }, elapsed: string) {
		const container = this.containerEl.children[1] as HTMLElement;
		const actionsSection = container.querySelector(".syncit-sidebar-actions");
		if (!actionsSection) return;

		this.completionSection = container.createDiv("syncit-sidebar-completion");
		this.completionSection.style.padding = "0 16px 12px";
		container.insertBefore(this.completionSection, actionsSection);

		// Title
		const title = this.completionSection.createEl("div");
		title.style.textAlign = "center";
		title.style.marginBottom = "10px";
		title.style.fontSize = "1em";
		title.style.fontWeight = "600";
		title.setText("✅ Sync complete");

		// Summary cards
		const cards: Array<{ count: number; label: string; sub: string; icon: string; color: string }> = [
			{ count: result.uploaded, label: "uploaded", sub: "new files", icon: "📤", color: "var(--color-green)" },
			{ count: result.skipped, label: "skipped", sub: "already identical", icon: "⏭️", color: "var(--text-muted)" },
			{ count: result.downloaded, label: "overwritten", sub: "server version older", icon: "🔄", color: "var(--color-blue)" },
			{ count: result.conflicts, label: "conflict", sub: "needs review", icon: "⚠️", color: "var(--color-orange)" },
		];

		for (const card of cards) {
			if (card.count === 0) continue;

			const row = this.completionSection.createDiv();
			row.style.display = "flex";
			row.style.alignItems = "center";
			row.style.gap = "10px";
			row.style.padding = "8px 12px";
			row.style.marginBottom = "4px";
			row.style.background = "var(--background-primary-alt)";
			row.style.borderRadius = "6px";

			const iconEl = row.createEl("span");
			iconEl.setText(card.icon);
			iconEl.style.fontSize = "1.2em";

			const info = row.createDiv();
			info.style.flex = "1";

			const countEl = info.createEl("div");
			countEl.style.fontSize = "1.2em";
			countEl.style.fontWeight = "700";
			countEl.style.color = card.color;
			countEl.setText(String(card.count));

			const labelEl = info.createEl("div");
			labelEl.style.fontSize = "0.8em";
			labelEl.style.color = "var(--text-muted)";
			labelEl.setText(`${card.label} · ${card.sub}`);
		}
	}

	private _removeCompletionUI() {
		if (this.completionSection) {
			this.completionSection.remove();
			this.completionSection = null;
		}
	}

	private _updateProgressBar() {
		if (!this.progressFillEl || !this.progressPercentEl) return;
		const pct = this.totalOps > 0 ? Math.round((this.completedOps / this.totalOps) * 100) : 0;
		this.progressFillEl.style.width = `${pct}%`;
		this.progressPercentEl.setText(`${pct}%`);
	}

	private _updateStats() {
		const values: Record<string, number> = {
			scanned: this.scanned,
			upload: this.uploaded,
			skip: this.skipped,
			overwrite: this.overwritten,
			conflict: this.conflicts,
		};
		for (const [key, { valueEl }] of this.statEls) {
			valueEl.setText(String(values[key] ?? 0));
		}
	}

	private _addFileLogEntry(path: string, operation: "upload" | "download" | "conflict" | "error", meta?: { size?: number }) {
		if (!this.fileLogEl) return;

		const row = this.fileLogEl.createDiv();
		row.style.display = "flex";
		row.style.alignItems = "center";
		row.style.gap = "6px";
		row.style.padding = "4px 6px";
		row.style.background = "var(--background-primary-alt)";
		row.style.borderRadius = "4px";

		const icon = row.createEl("span");
		icon.style.width = "18px";
		icon.style.textAlign = "center";
		icon.style.fontSize = "0.9em";
		const icons: Record<string, string> = {
			upload: "📄",
			download: "🔄",
			conflict: "⚠️",
			error: "❌",
		};
		icon.setText(icons[operation] || "•");

		const info = row.createDiv();
		info.style.flex = "1";
		info.style.minWidth = "0";
		info.style.overflow = "hidden";

		const pathEl = info.createEl("div");
		pathEl.style.overflow = "hidden";
		pathEl.style.textOverflow = "ellipsis";
		pathEl.style.whiteSpace = "nowrap";
		pathEl.setText(path);

		const metaEl = info.createEl("div");
		metaEl.style.fontSize = "0.8em";
		metaEl.style.color = "var(--text-faint)";

		const subtitles: Record<string, string> = {
			upload: "Not found",
			download: "Server older",
			conflict: "Changed",
			error: "Failed",
		};
		const sizeText = meta?.size ? ` · ${formatBytes(meta.size)}` : "";
		metaEl.setText(`${subtitles[operation]}${sizeText}`);

		const badge = row.createEl("span");
		badge.style.fontSize = "0.7em";
		badge.style.padding = "2px 6px";
		badge.style.borderRadius = "3px";
		badge.style.fontWeight = "600";
		badge.style.whiteSpace = "nowrap";

		const badgeStyles: Record<string, { bg: string; color: string }> = {
			upload: { bg: "rgba(var(--color-green-rgb), 0.12)", color: "var(--color-green)" },
			download: { bg: "rgba(var(--color-blue-rgb), 0.12)", color: "var(--color-blue)" },
			conflict: { bg: "rgba(var(--color-orange-rgb), 0.12)", color: "var(--color-orange)" },
			error: { bg: "rgba(var(--color-red-rgb), 0.12)", color: "var(--color-red)" },
		};
		const style = badgeStyles[operation] || badgeStyles.error;
		badge.style.background = style.bg;
		badge.style.color = style.color;

		const badgeLabels: Record<string, string> = {
			upload: "Uploaded",
			download: "Overwritten",
			conflict: "Resolved",
			error: "Error",
		};
		badge.setText(badgeLabels[operation] || "Done");

		// Keep only last 20 entries
		while (this.fileLogEl.children.length > 20) {
			this.fileLogEl.firstChild?.remove();
		}

		this.fileLogEl.scrollTop = this.fileLogEl.scrollHeight;
	}

	async onClose() {
		// Nothing to clean up
	}
}

function formatBytes(bytes: number): string {
	if (bytes === 0) return "0 B";
	const k = 1024;
	const sizes = ["B", "KB", "MB", "GB"];
	const i = Math.floor(Math.log(bytes) / Math.log(k));
	return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}
