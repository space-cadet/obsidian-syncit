import { ItemView, Menu, WorkspaceLeaf } from "obsidian";
import type SyncItPlugin from "../main";
import type {
	FileEntity,
	ReconciliationDecision,
	ReconciliationMode,
	SyncPlan,
	SyncResult,
} from "../types";

export const SYNC_SIDEBAR_VIEW_TYPE = "syncit-sidebar";

type FileLogOperation =
	| "upload" | "download" | "conflict" | "error" | "delete"
	| "planned-upload" | "planned-download" | "planned-conflict" | "planned-error" | "planned-delete";

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
	private progressSizeEl: HTMLElement | null = null;
	private statEls: Map<string, { valueEl: HTMLElement; labelEl: HTMLElement }> = new Map();
	private fileLogEl: HTMLElement | null = null;
	private cancelBtn: HTMLElement | null = null;
	private completionSection: HTMLElement | null = null;
	private reconciliationSection: HTMLElement | null = null;
	// Persistent log section (always visible)
	private logSection: HTMLElement | null = null;
	private logHeaderEl: HTMLElement | null = null;
	private logListEl: HTMLElement | null = null;

	// State
	private isSyncing = false;
	private startTime = 0;
	private totalOps = 0;
	private completedOps = 0;
	private totalBytes = 0;
	private transferredBytes = 0;
	private scanned = 0;
	private uploaded = 0;
	private skipped = 0;
	private overwritten = 0;
	private deleted = 0;
	private conflicts = 0;
	private currentPlan: SyncPlan | null = null;
	private selectedMode: ReconciliationMode;

	constructor(leaf: WorkspaceLeaf, plugin: SyncItPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.selectedMode = plugin.settings.syncDirection;
	}

	getViewType(): string { return SYNC_SIDEBAR_VIEW_TYPE; }
	getDisplayText(): string { return "SyncIt"; }
	getIcon(): string { return "sync"; }

	async onOpen() {
		const container = this.containerEl.children[1] as HTMLElement;
		container.empty();
		container.addClass("syncit-sidebar");
		container.style.display = "flex";
		container.style.flexDirection = "column";
		container.style.height = "100%";
		container.style.minWidth = "0";
		container.style.overflowX = "hidden";

		// Header
		const header = container.createDiv("syncit-sidebar-header");
		header.style.padding = "12px 16px";
		header.style.borderBottom = "1px solid var(--background-modifier-border)";
		header.style.display = "flex";
		header.style.alignItems = "center";
		header.style.gap = "8px";
		header.style.minWidth = "0";

		const icon = header.createEl("span");
		icon.setText("🔄");
		icon.style.fontSize = "1.2em";

		const title = header.createEl("h3");
		title.setText("SyncIt");
		title.style.margin = "0";
		title.style.fontSize = "1.1em";
		title.style.fontWeight = "600";
		title.style.flex = "1";
		title.style.minWidth = "0";

		this.settingsBtn = header.createEl("button", { attr: { "aria-label": "Open SyncIt settings", "title": "Settings" } });
		this.settingsBtn.setText("⚙");
		this.settingsBtn.style.flex = "0 0 auto";
		this.settingsBtn.style.fontSize = "1.1em";
		this.settingsBtn.style.padding = "2px 6px";
		this.settingsBtn.addEventListener("click", () => this.openSettings());

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

		// Actions section — single-column layout so narrow sidebars never overflow.
		const actionsSection = container.createDiv("syncit-sidebar-actions");
		actionsSection.style.padding = "12px 16px";
		actionsSection.style.display = "flex";
		actionsSection.style.flexDirection = "column";
		actionsSection.style.gap = "8px";

		this.syncBtn = actionsSection.createEl("button", { text: "Sync" });
		this.syncBtn.style.width = "100%";
		this.syncBtn.style.boxSizing = "border-box";
		this.syncBtn.addClass("mod-cta");
		this.syncBtn.addEventListener("click", (event) => this.openSyncMenu(event));

		const dryRunBtn = actionsSection.createEl("button", { text: "Dry Run" });
		dryRunBtn.style.width = "100%";
		dryRunBtn.style.boxSizing = "border-box";
		dryRunBtn.addEventListener("click", () => this.plugin.performDryRun());

		const rebuildBtn = actionsSection.createEl("button", { text: "Rebuild Index" });
		rebuildBtn.style.width = "100%";
		rebuildBtn.style.boxSizing = "border-box";
		rebuildBtn.addEventListener("click", () => this.plugin.rebuildIndex());

		// Spacer
		const spacer = container.createDiv();
		spacer.style.flex = "0 0 0";

		// Persistent sync log section (always visible)
		this.logSection = container.createDiv("syncit-sidebar-log");
		this.logSection.style.padding = "12px 16px";
		this.logSection.style.borderTop = "1px solid var(--background-modifier-border)";
		this.logSection.style.display = "flex";
		this.logSection.style.flexDirection = "column";
		this.logSection.style.flex = "1 1 0";
		this.logSection.style.minHeight = "260px";
		this.logSection.style.maxHeight = "60vh";

		this.logHeaderEl = this.logSection.createEl("div");
		this.logHeaderEl.style.fontSize = "0.75em";
		this.logHeaderEl.style.color = "var(--text-faint)";
		this.logHeaderEl.style.marginBottom = "6px";
		this.logHeaderEl.setText("Recent Activity");

		this.logListEl = this.logSection.createDiv();
		this.logListEl.style.flex = "1";
		this.logListEl.style.minHeight = "0";
		this.logListEl.style.overflowY = "auto";
		this.logListEl.style.display = "flex";
		this.logListEl.style.flexDirection = "column";
		this.logListEl.style.gap = "3px";
		this.logListEl.style.fontSize = "0.85em";

		// Connection info
		const infoSection = container.createDiv("syncit-sidebar-info");
		infoSection.style.padding = "12px 16px";
		infoSection.style.fontSize = "0.8em";
		infoSection.style.color = "var(--text-muted)";
		infoSection.style.borderTop = "1px solid var(--background-modifier-border)";

		const url = this.plugin.settings.webdavUrl || "Not configured";
		infoSection.createEl("div", { text: `Server: ${url}` });
	}

	updateSyncMode() {
		this.selectedMode = this.plugin.settings.syncDirection;
	}

	private openSyncMenu(event: MouseEvent) {
		const menu = new Menu();

		// Mode selection + sync actions
		menu.addItem(item => item
			.setTitle("↕ Two-way sync")
			.setIcon("refresh-cw")
			.onClick(() => this.plugin.performSync("two-way")));
		menu.addItem(item => item
			.setTitle("↕ Two-way dry run")
			.setIcon("test-tube")
			.onClick(() => this.plugin.performDryRun("two-way")));

		menu.addSeparator();

		menu.addItem(item => item
			.setTitle("↑ Upload only")
			.setIcon("upload")
			.onClick(() => this.plugin.performSync("upload-only")));
		menu.addItem(item => item
			.setTitle("↑ Upload only dry run")
			.setIcon("test-tube")
			.onClick(() => this.plugin.performDryRun("upload-only")));

		menu.addSeparator();

		menu.addItem(item => item
			.setTitle("↓ Download only")
			.setIcon("download")
			.onClick(() => this.plugin.performSync("download-only")));
		menu.addItem(item => item
			.setTitle("↓ Download only dry run")
			.setIcon("test-tube")
			.onClick(() => this.plugin.performDryRun("download-only")));

		menu.showAtMouseEvent(event);
	}

	private openSettings() {
		// @ts-ignore Obsidian's settings API is not exposed in the public typings.
		this.app.setting.open();
		// @ts-ignore
		this.app.setting.openTabById(this.plugin.manifest.id);
	}

	// ─── Progress API ───

	/** Phase 2: Show pre-sync plan summary. */
	setPlan(plan: SyncPlan) {
		this.isSyncing = true;
		this._removeReconciliationUI();
		this.startTime = Date.now();
		this._clearLog();
		if (this.logHeaderEl) {
			this.logHeaderEl.setText("Syncing…");
			this.logHeaderEl.style.color = "var(--interactive-accent)";
		}
		this.totalOps = plan.uploads.length + plan.downloads.length + plan.localDeletes.length + plan.conflicts.length + plan.remoteDeletes.length;
		this.completedOps = 0;
		this.totalBytes = plan.uploadSize + plan.downloadSize;
		this.transferredBytes = 0;
		this.scanned = plan.uploads.length + plan.downloads.length + plan.localDeletes.length + plan.conflicts.length + plan.unchanged + plan.remoteDeletes.length + plan.reconciliation.length;
		this.uploaded = 0;
		this.skipped = plan.unchanged;
		this.overwritten = 0;
		this.deleted = 0;
		this.conflicts = 0;
		this.currentPlan = plan;

		this.statusEl.setText("Syncing...");

		// Pre-sync summary
		const parts: string[] = [];
		if (plan.uploads.length > 0) parts.push(`${plan.uploads.length}↑ ${formatBytes(plan.uploadSize)}`);
		if (plan.downloads.length > 0) parts.push(`${plan.downloads.length}↓ ${formatBytes(plan.downloadSize)}`);
		const deleteCount = plan.localDeletes.length + plan.remoteDeletes.length;
		if (deleteCount > 0) parts.push(`${deleteCount}🗑`);
		if (plan.unchanged > 0) parts.push(`${plan.unchanged}⏭`);
		if (plan.reconciliation.length > 0) parts.push(`${plan.reconciliation.length}⚠️ review`);
		this.lastSyncEl.setText(parts.join(" · ") || "Nothing to sync");

		this._removeCompletionUI();
		this.syncBtn.style.display = "none";
		this._ensureProgressUI();
		this._updateProgressBar();
		this._updateStats();
	}

	/** Stop before transfers when the plan contains ambiguous or destructive decisions. */
	setReconciliationRequired(plan: SyncPlan) {
		this.isSyncing = false;
		this.currentPlan = plan;
		this.statusEl.setText("Reconciliation required");
		this.lastSyncEl.setText(
			`${plan.reconciliation.length} file(s) need a decision before syncing`,
		);
		this._removeProgressUI();
		this._removeCompletionUI();
		this._renderReconciliationReview(plan);
		if (this.logHeaderEl) {
			this.logHeaderEl.setText("⚠️ Reconciliation required");
			this.logHeaderEl.style.color = "var(--text-warning)";
		}
		this.syncBtn.style.display = "none";
	}

	private _renderReconciliationReview(plan: SyncPlan) {
		this._removeReconciliationUI();
		const container = this.containerEl.children[1] as HTMLElement;
		const actionsSection = container.querySelector(".syncit-sidebar-actions");
		if (!actionsSection) return;

		this.reconciliationSection = container.createDiv("syncit-sidebar-reconciliation");
		this.reconciliationSection.style.padding = "0 16px 12px";
		container.insertBefore(this.reconciliationSection, actionsSection);

		const title = this.reconciliationSection.createEl("div");
		title.style.fontWeight = "600";
		title.style.color = "var(--text-warning)";
		title.setText("⚠️ Review before syncing");

		const description = this.reconciliationSection.createEl("div");
		description.style.fontSize = "0.8em";
		description.style.color = "var(--text-muted)";
		description.style.margin = "4px 0 8px";
		description.setText("Nothing will change until you choose an action for every file.");

		const modeRow = this.reconciliationSection.createDiv();
		modeRow.style.display = "flex";
		modeRow.style.alignItems = "center";
		modeRow.style.gap = "8px";
		modeRow.style.marginBottom = "8px";
		const modeLabel = modeRow.createEl("span");
		modeLabel.style.fontSize = "0.8em";
		modeLabel.setText("Default policy");
		const modeSelect = modeRow.createEl("select") as HTMLSelectElement;
		modeSelect.style.flex = "1";
		const modes: Array<{ value: ReconciliationMode; label: string }> = [
			{ value: "two-way", label: "Two-way — review each file" },
			{ value: "upload-only", label: "Upload-only — keep local files" },
			{ value: "download-only", label: "Download-only — use remote files" },
		];
		for (const mode of modes) {
			modeSelect.createEl("option", { value: mode.value, text: mode.label });
		}

		const itemList = this.reconciliationSection.createDiv();
		itemList.style.maxHeight = "min(52vh, 460px)";
		itemList.style.overflowY = "auto";
		itemList.style.border = "1px solid var(--background-modifier-border)";
		itemList.style.borderRadius = "6px";
		itemList.style.padding = "4px";

		const itemSelects = new Map<string, HTMLSelectElement>();
		for (const item of plan.reconciliation) {
			const row = itemList.createDiv();
			row.style.padding = "8px";
			row.style.borderBottom = "1px solid var(--background-modifier-border)";
			row.style.minWidth = "0";

			const pathEl = row.createEl("div");
			pathEl.style.fontWeight = "500";
			pathEl.style.overflow = "hidden";
			pathEl.style.textOverflow = "ellipsis";
			pathEl.style.whiteSpace = "nowrap";
			pathEl.setText(item.path);

			const reasonEl = row.createEl("div");
			reasonEl.style.fontSize = "0.75em";
			reasonEl.style.color = "var(--text-muted)";
			reasonEl.setText(`${reconciliationReasonLabel(item.reason)} · ${fileSummary(item)}`);

			const choice = row.createEl("select") as HTMLSelectElement;
			choice.style.width = "100%";
			choice.style.marginTop = "5px";
			for (const option of [
				{ value: "skip", label: "Choose an action" },
				{ value: "use-local", label: "Use local version" },
				{ value: "use-remote", label: "Use remote version" },
				{ value: "keep-both", label: "Keep both versions" },
			]) {
				choice.createEl("option", { value: option.value, text: option.label });
			}
			itemSelects.set(item.path, choice);
		}

		const buttonRow = this.reconciliationSection.createDiv();
		buttonRow.style.display = "flex";
		buttonRow.style.gap = "8px";
		buttonRow.style.marginTop = "8px";
		const cancelButton = buttonRow.createEl("button", { text: "Cancel" });
		const applyButton = buttonRow.createEl("button", { text: "Apply decisions" });
		applyButton.addClass("mod-cta");
		applyButton.disabled = true;

		const updateApplyState = () => {
			applyButton.disabled = Array.from(itemSelects.values()).some(select => select.value === "skip");
		};
		for (const select of itemSelects.values()) {
			select.addEventListener("change", updateApplyState);
		}
		modeSelect.addEventListener("change", () => {
			const decision = modeSelect.value === "upload-only" ? "use-local" : modeSelect.value === "download-only" ? "use-remote" : "skip";
			for (const select of itemSelects.values()) select.value = decision;
			updateApplyState();
		});
		cancelButton.addEventListener("click", () => this.plugin.cancelReconciliation());
		applyButton.addEventListener("click", () => {
			const decisions: Record<string, ReconciliationDecision> = {};
			for (const [path, select] of itemSelects) {
				decisions[path] = select.value as ReconciliationDecision;
			}
			this.plugin.applyReconciliation(plan, modeSelect.value as ReconciliationMode, decisions);
		});
	}

	/** Phase 3: Called during transfer with size-based progress. */
	updateProgress(current: number, total: number, operation: string, path: string, bytesTransferred: number, totalBytes: number) {
		this.completedOps = current;
		this.transferredBytes = bytesTransferred;
		this.totalBytes = totalBytes;
		this._updateProgressBar();

		const elapsed = Date.now() - this.startTime;
		this.lastSyncEl.setText(`${current} of ${total} · ${formatDuration(elapsed)}`);

		// Track counters
		const opType = operation.includes("upload") ? "upload" :
			operation.includes("download") ? "download" :
			operation.includes("delete") ? "delete" :
			operation.includes("conflict") ? "conflict" : "upload";

		if (opType === "upload") this.uploaded++;
		else if (opType === "download") this.overwritten++;
		else if (opType === "delete") this.deleted++;
		else if (opType === "conflict") this.conflicts++;

		this._updateStats();

		// File log
		let size = 0;
		if (this.currentPlan) {
			const uploadFile = this.currentPlan.uploads.find(f => f.path === path || f.targetPath === path);
			const downloadFile = this.currentPlan.downloads.find(f => f.path === path || f.targetPath === path);
			const conflict = this.currentPlan.conflicts.find(c => c.local.path === path || c.remote.path === path);
			size = uploadFile?.size ?? downloadFile?.size ?? 0;
			if (conflict) size = operation.includes("upload") ? conflict.local.size : conflict.remote.size;
		}

		this._addFileLogEntry(path, operation.includes("(dry-run)") ? `planned-${opType}` : opType, { size });
	}

	finish(result: SyncResult & { message: string }) {
		this.isSyncing = false;
		this._removeReconciliationUI();
		const elapsed = Date.now() - this.startTime;
		if (this.logHeaderEl) {
			this.logHeaderEl.setText(`✅ Sync complete · ${formatDuration(elapsed)}`);
			this.logHeaderEl.style.color = "var(--text-success)";
		}

		this.statusEl.setText("Ready");
		this.lastSyncEl.setText(`${result.message} · ${formatDuration(elapsed)}`);

		this._removeProgressUI(); // removes bar, stats, cancel — log stays
		this.syncBtn.style.display = "block";
		(this.syncBtn as HTMLButtonElement).disabled = false;
		this.syncBtn.setText("Sync");
		this._showCompletionSummary(result, elapsed);
	}

	/** Show dry run result — no transfers happened. */
	showDryRunResult(result: SyncResult & { message: string }) {
		this.isSyncing = false;
		this._removeReconciliationUI();
		if (this.logHeaderEl) {
			this.logHeaderEl.setText("🧪 Dry run complete — no changes made");
			this.logHeaderEl.style.color = "var(--text-accent)";
		}

		this.statusEl.setText("Ready");
		this.lastSyncEl.setText(result.message);

		this._removeProgressUI();
		this.syncBtn.style.display = "block";
		(this.syncBtn as HTMLButtonElement).disabled = false;
		this.syncBtn.setText("Sync");

		// Show summary cards
		const container = this.containerEl.children[1] as HTMLElement;
		const actionsSection = container.querySelector(".syncit-sidebar-actions");
		if (!actionsSection) return;

		this.completionSection = container.createDiv("syncit-sidebar-completion");
		this.completionSection.style.padding = "0 16px 12px";
		container.insertBefore(this.completionSection, actionsSection);

		const title = this.completionSection.createEl("div");
		title.style.textAlign = "center";
		title.style.marginBottom = "10px";
		title.style.fontSize = "1em";
		title.style.fontWeight = "600";
		title.style.color = "var(--text-accent)";
		title.setText("🧪 Dry Run Result");

		const cards: Array<{ count: number; label: string; sub: string; icon: string; color: string }> = [
			{ count: result.uploaded, label: "would upload", sub: formatBytes(result.uploadedBytes), icon: "📤", color: "var(--color-green)" },
			{ count: result.downloaded, label: "would download", sub: formatBytes(result.downloadedBytes), icon: "🔄", color: "var(--color-blue)" },
			{ count: result.deleted, label: "would delete", sub: "local or remote", icon: "🗑", color: "var(--text-error)" },
			{ count: result.conflicts, label: "conflicts", sub: "need review", icon: "⚠️", color: "var(--color-orange)" },
			{ count: result.skipped, label: "skipped", sub: "already identical", icon: "⏭️", color: "var(--text-muted)" },
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

		const note = this.completionSection.createEl("div");
		note.style.textAlign = "center";
		note.style.marginTop = "8px";
		note.style.fontSize = "0.8em";
		note.style.color = "var(--text-faint)";
		note.style.fontStyle = "italic";
		note.setText("No changes were made. Choose a direction and click the sync button to apply.");
	}

	setCancelled() {
		this.isSyncing = false;
		this._removeReconciliationUI();
		this.statusEl.setText("Cancelled");
		this.lastSyncEl.setText("Sync was cancelled");
		this._removeProgressUI();
		if (this.logHeaderEl) {
			this.logHeaderEl.setText("Sync cancelled");
			this.logHeaderEl.style.color = "var(--text-warning)";
		}
		this._removeCompletionUI();
		this.syncBtn.style.display = "block";
		(this.syncBtn as HTMLButtonElement).disabled = false;
		this.syncBtn.setText("Sync");
	}

	setError(message: string) {
		this.isSyncing = false;
		this._removeReconciliationUI();
		this.statusEl.setText("Sync failed");
		this.lastSyncEl.setText(message);
		this._removeProgressUI();
		if (this.logHeaderEl) {
			this.logHeaderEl.setText("Sync failed");
			this.logHeaderEl.style.color = "var(--text-error)";
		}
		this._removeCompletionUI();
		this.syncBtn.style.display = "block";
		(this.syncBtn as HTMLButtonElement).disabled = false;
		this.syncBtn.setText("Sync");
	}

	// ─── Idle State ───

	updateStatus(status: string, lastSync?: string) {
		if (!this.isSyncing) {
			this.statusEl.setText(status);
			if (lastSync) this.lastSyncEl.setText(`Last sync: ${lastSync}`);
		}
	}

	setSyncing(syncing: boolean) {
		if (!syncing && !this.isSyncing) {
			(this.syncBtn as HTMLButtonElement).disabled = false;
			this.syncBtn.setText("Sync");
		}
	}

	/** Show spinner during scan phase (before plan is ready). */
	setScanning() {
		this.statusEl.setText("Scanning...");
		this.lastSyncEl.setText("Comparing local and remote files");
		if (this.logHeaderEl) {
			this.logHeaderEl.setText("⏳ Scanning...");
			this.logHeaderEl.style.color = "var(--interactive-accent)";
		}
	}

	// ─── Private UI ───

	private _ensureProgressUI() {
		if (this.progressSection) return;

		const container = this.containerEl.children[1] as HTMLElement;
		const actionsSection = container.querySelector(".syncit-sidebar-actions");
		if (!actionsSection) return;

		this.progressSection = container.createDiv("syncit-sidebar-progress-section");
		this.progressSection.style.padding = "0 16px 12px";
		container.insertBefore(this.progressSection, actionsSection);

		// Progress bar
		const progressContainer = this.progressSection.createDiv();
		progressContainer.style.height = "6px";
		progressContainer.style.background = "var(--background-modifier-border)";
		progressContainer.style.borderRadius = "3px";
		progressContainer.style.marginBottom = "4px";
		progressContainer.style.overflow = "hidden";

		this.progressFillEl = progressContainer.createDiv();
		this.progressFillEl.style.height = "100%";
		this.progressFillEl.style.width = "0%";
		this.progressFillEl.style.background = "var(--interactive-accent)";
		this.progressFillEl.style.transition = "width 0.2s ease";
		this.progressFillEl.style.borderRadius = "3px";

		// Percent + size row
		const infoRow = this.progressSection.createDiv();
		infoRow.style.display = "flex";
		infoRow.style.justifyContent = "space-between";
		infoRow.style.marginBottom = "8px";

		this.progressPercentEl = infoRow.createEl("span");
		this.progressPercentEl.style.fontSize = "0.75em";
		this.progressPercentEl.style.color = "var(--text-muted)";
		this.progressPercentEl.setText("0%");

		this.progressSizeEl = infoRow.createEl("span");
		this.progressSizeEl.style.fontSize = "0.75em";
		this.progressSizeEl.style.color = "var(--text-muted)";
		this.progressSizeEl.setText("0 B / 0 B");

		// Stats row
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
			{ key: "delete", label: "delete", color: "var(--text-error)" },
			{ key: "conflict", label: "conflict", color: "var(--text-warning)" },
		];

		for (const def of statDefs) {
			const card = statsRow.createDiv();
			card.style.textAlign = "center";
			card.style.flex = "1";
			card.style.minWidth = "40px";

			const valueEl = card.createEl("div");
			valueEl.style.fontSize = "1em";
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
		this.cancelBtn.addEventListener("click", () => this.plugin.cancelSync());

		// Operations log header (entries go to persistent logListEl)
		const logHeader = this.progressSection.createEl("div");
		logHeader.style.fontSize = "0.75em";
		logHeader.style.color = "var(--text-faint)";
		logHeader.style.marginTop = "8px";
		logHeader.setText("Operations");
	}

	private _removeProgressUI() {
		if (this.progressSection) {
			this.progressSection.remove();
			this.progressSection = null;
			this.progressFillEl = null;
			this.progressPercentEl = null;
			this.progressSizeEl = null;
			this.fileLogEl = null;
			this.cancelBtn = null;
			this.statEls.clear();
		}
	}

	private _showCompletionSummary(result: SyncResult & { message: string }, elapsedMs: number) {
		const container = this.containerEl.children[1] as HTMLElement;
		const actionsSection = container.querySelector(".syncit-sidebar-actions");
		if (!actionsSection) return;

		this.completionSection = container.createDiv("syncit-sidebar-completion");
		this.completionSection.style.padding = "0 16px 12px";
		container.insertBefore(this.completionSection, actionsSection);

		const title = this.completionSection.createEl("div");
		title.style.textAlign = "center";
		title.style.marginBottom = "10px";
		title.style.fontSize = "1em";
		title.style.fontWeight = "600";
		title.setText("✅ Sync complete");

		const cards: Array<{ count: number; label: string; sub: string; icon: string; color: string }> = [
			{ count: result.uploaded, label: "uploaded", sub: formatBytes(result.uploadedBytes), icon: "📤", color: "var(--color-green)" },
			{ count: result.skipped, label: "skipped", sub: "already identical", icon: "⏭️", color: "var(--text-muted)" },
			{ count: result.downloaded, label: "downloaded", sub: formatBytes(result.downloadedBytes), icon: "🔄", color: "var(--color-blue)" },
			{ count: result.deleted, label: "deleted", sub: "local or remote", icon: "🗑", color: "var(--text-error)" },
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

		// Duration
		const durationEl = this.completionSection.createEl("div");
		durationEl.style.textAlign = "center";
		durationEl.style.marginTop = "8px";
		durationEl.style.fontSize = "0.8em";
		durationEl.style.color = "var(--text-faint)";
		durationEl.setText(`Completed in ${formatDuration(elapsedMs)}`);
	}

	private _removeCompletionUI() {
		if (this.completionSection) {
			this.completionSection.remove();
			this.completionSection = null;
		}
	}

	private _removeReconciliationUI() {
		if (this.reconciliationSection) {
			this.reconciliationSection.remove();
			this.reconciliationSection = null;
		}
	}

	private _updateProgressBar() {
		if (!this.progressFillEl || !this.progressPercentEl || !this.progressSizeEl) return;
		const pct = this.totalBytes > 0 ? Math.round((this.transferredBytes / this.totalBytes) * 100) : 0;
		this.progressFillEl.style.width = `${pct}%`;
		this.progressPercentEl.setText(`${pct}%`);
		this.progressSizeEl.setText(`${formatBytes(this.transferredBytes)} / ${formatBytes(this.totalBytes)}`);
	}

	private _updateStats() {
		const values: Record<string, number> = {
			scanned: this.scanned,
			upload: this.uploaded,
			skip: this.skipped,
			overwrite: this.overwritten,
			delete: this.deleted,
			conflict: this.conflicts,
		};
		for (const [key, { valueEl }] of this.statEls) {
			valueEl.setText(String(values[key] ?? 0));
		}
	}

	private _addFileLogEntry(path: string, operation: FileLogOperation, meta?: { size?: number }) {
		if (!this.logListEl) return;
		const isPlanned = operation.startsWith("planned-");
		const baseOperation = (isPlanned ? operation.slice("planned-".length) : operation) as Exclude<FileLogOperation, `planned-${string}`>;

		const row = this.logListEl.createDiv();
		row.style.display = "flex";
		row.style.alignItems = "center";
		row.style.gap = "6px";
		row.style.padding = "4px 6px";
		row.style.background = "var(--background-primary-alt)";
		row.style.borderRadius = "4px";

		const icons: Record<string, string> = {
			upload: "📄",
			download: "🔄",
			delete: "🗑",
			conflict: "⚠️",
			error: "❌",
		};

		const icon = row.createEl("span");
		icon.setText(icons[baseOperation] || "•");
		icon.style.width = "18px";
		icon.style.textAlign = "center";
		icon.style.fontSize = "0.9em";

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
			upload: "Uploading",
			download: "Downloading",
			delete: "Deleting",
			conflict: "Conflict",
			error: "Failed",
		};
		const sizeText = meta?.size ? ` · ${formatBytes(meta.size)}` : "";
		metaEl.setText(`${isPlanned ? "Would " : ""}${subtitles[baseOperation]}${sizeText}`);

		const badge = row.createEl("span");
		badge.style.fontSize = "0.7em";
		badge.style.padding = "2px 6px";
		badge.style.borderRadius = "3px";
		badge.style.fontWeight = "600";
		badge.style.whiteSpace = "nowrap";

		const badgeStyles: Record<string, { bg: string; color: string }> = {
			upload: { bg: "rgba(var(--color-green-rgb), 0.12)", color: "var(--color-green)" },
			download: { bg: "rgba(var(--color-blue-rgb), 0.12)", color: "var(--color-blue)" },
			delete: { bg: "rgba(var(--color-red-rgb), 0.12)", color: "var(--color-red)" },
			conflict: { bg: "rgba(var(--color-orange-rgb), 0.12)", color: "var(--color-orange)" },
			error: { bg: "rgba(var(--color-red-rgb), 0.12)", color: "var(--color-red)" },
		};
		const style = badgeStyles[baseOperation] || badgeStyles.error;
		badge.style.background = style.bg;
		badge.style.color = style.color;

		const badgeLabels: Record<string, string> = {
			upload: "Uploaded",
			download: "Downloaded",
			delete: "Deleted",
			conflict: "Resolved",
			error: "Error",
		};
		const plannedLabels: Record<string, string> = {
			upload: "Would upload",
			download: "Would download",
			delete: "Would delete",
			conflict: "Would review",
			error: "Would fail",
		};
		badge.setText(isPlanned ? (plannedLabels[baseOperation] || "Would process") : (badgeLabels[baseOperation] || "Done"));

		while (this.logListEl.children.length > 50) {
			this.logListEl.firstChild?.remove();
		}
		this.logListEl.scrollTop = this.logListEl.scrollHeight;
	}

	private _clearLog() {
		if (this.logListEl) {
			this.logListEl.empty();
		}
	}

	async onClose() {}
}

function formatBytes(bytes: number): string {
	if (bytes === 0) return "0 B";
	const k = 1024;
	const sizes = ["B", "KB", "MB", "GB"];
	const i = Math.floor(Math.log(bytes) / Math.log(k));
	return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

function formatDuration(ms: number): string {
	if (ms < 1000) return `${ms}ms`;
	const seconds = Math.floor(ms / 1000);
	const mins = Math.floor(seconds / 60);
	const secs = seconds % 60;
	if (mins === 0) return `${secs}s`;
	return `${mins}m ${secs.toString().padStart(2, "0")}s`;
}

function reconciliationReasonLabel(reason: SyncPlan["reconciliation"][number]["reason"]): string {
	const labels: Record<typeof reason, string> = {
		"no-baseline-local-only": "Only on this device; no shared baseline",
		"no-baseline-remote-only": "Only on the remote; no shared baseline",
		"no-baseline-conflict": "Both sides differ; no shared baseline",
		"possible-remote-deletion": "Possible deletion on the remote",
		"possible-local-deletion": "Possible deletion on this device",
	};
	return labels[reason];
}

function fileSummary(item: SyncPlan["reconciliation"][number]): string {
	const local = item.local ? `local ${formatBytes(item.local.size)}` : "no local file";
	const remote = item.remote ? `remote ${formatBytes(item.remote.size)}` : "no remote file";
	return `${local}, ${remote}`;
}
