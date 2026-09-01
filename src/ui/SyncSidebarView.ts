import { ItemView, WorkspaceLeaf, Notice } from "obsidian";
import type SyncItPlugin from "../main";
import type { LogEntry, LogLevel } from "../logging/SyncLogger";
import type {
	FileEntity,
	ReconciliationDecision,
	ReconciliationMode,
	SyncPlan,
	SyncResult,
} from "../types";

export const SYNC_SIDEBAR_VIEW_TYPE = "syncit-sidebar";

type SidebarTab = "sync" | "log";

type FileLogOperation =
	| "upload" | "download" | "conflict" | "error" | "delete"
	| "planned-upload" | "planned-download" | "planned-conflict" | "planned-error" | "planned-delete";

export class SyncSidebarView extends ItemView {
	private plugin: SyncItPlugin;

	// ── Tabs ──
	private activeTab: SidebarTab = "sync";
	private tabsContainer!: HTMLElement;
	private contentContainer!: HTMLElement;
	private syncContent!: HTMLElement;
	private syncScrollContainer!: HTMLElement;
	private logContent!: HTMLElement;

	// ── Sync tab UI ──
	private statusEl!: HTMLElement;
	private lastSyncEl!: HTMLElement;
	private syncBtn!: HTMLElement;
	private settingsBtn!: HTMLElement;
	private progressSection: HTMLElement | null = null;
	private progressFillEl: HTMLElement | null = null;
	private progressPercentEl: HTMLElement | null = null;
	private progressSizeEl: HTMLElement | null = null;
	private statEls: Map<string, { valueEl: HTMLElement; labelEl: HTMLElement }> = new Map();
	private cancelBtn: HTMLElement | null = null;
	private completionSection: HTMLElement | null = null;
	private reconciliationSection: HTMLElement | null = null;
	private logSection: HTMLElement | null = null;
	private logHeaderEl: HTMLElement | null = null;
	private logListEl: HTMLElement | null = null;

	// ── Log tab UI ──
	private logFilter: LogFilter = "ALL";
	private logSearchQuery = "";
	private logFilterBtns: Map<LogFilter, HTMLElement> = new Map();
	private logSearchInput: HTMLInputElement | null = null;
	private logListContainer: HTMLElement | null = null;
	private logFooterEl: HTMLElement | null = null;
	private logRefreshInterval: number | null = null;

	// ── State ──
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

		// ── Tabs wrapper ──
		const tabsWrapper = container.createDiv("syncit-tabs-wrapper");
		tabsWrapper.style.display = "flex";
		tabsWrapper.style.alignItems = "center";
		tabsWrapper.style.gap = "8px";
		tabsWrapper.style.padding = "8px 16px";
		tabsWrapper.style.borderBottom = "1px solid var(--background-modifier-border)";
		tabsWrapper.style.background = "var(--background-primary-alt)";

		this.tabsContainer = tabsWrapper.createDiv("syncit-tabs");
		this.tabsContainer.setAttr("role", "tablist");
		this.tabsContainer.setAttr("aria-label", "SyncIt views");
		this.tabsContainer.style.display = "flex";
		this.tabsContainer.style.gap = "4px";
		this.tabsContainer.style.flex = "1";

		this.settingsBtn = tabsWrapper.createEl("button", {
			attr: { "aria-label": "Open SyncIt settings", title: "Settings" },
		});
		this.settingsBtn.setText("⚙");
		this.settingsBtn.style.fontSize = "1.1em";
		this.settingsBtn.style.padding = "2px 6px";
		this.settingsBtn.style.flex = "0 0 auto";
		this.settingsBtn.addEventListener("click", () => this.openSettings());

		this.renderTabs();

		// ── Content container ──
		this.contentContainer = container.createDiv("syncit-content-container");
		this.contentContainer.style.flex = "1";
		this.contentContainer.style.minHeight = "0";
		this.contentContainer.style.overflow = "hidden";
		this.contentContainer.style.display = "flex";
		this.contentContainer.style.flexDirection = "column";

		// Build both tab contents
		this.buildSyncTab();
		this.buildLogTab();

		this.showTab("sync");

		// Auto-refresh log when visible
		this.logRefreshInterval = window.setInterval(() => {
			if (this.activeTab === "log" && this.containerEl.isShown()) {
				void this.refreshLogTab();
			}
		}, 3000);
	}

	async onClose(): Promise<void> {
		if (this.logRefreshInterval !== null) {
			window.clearInterval(this.logRefreshInterval);
			this.logRefreshInterval = null;
		}
	}

	// ═══════════════════════════════════════
	//  Tabs
	// ═══════════════════════════════════════

	private renderTabs(): void {
		this.tabsContainer.empty();
		const tabs: { id: SidebarTab; label: string }[] = [
			{ id: "sync", label: "Sync" },
			{ id: "log", label: "Log" },
		];
		for (const tab of tabs) {
			const btn = this.tabsContainer.createEl("button", {
				text: tab.label,
				attr: {
					role: "tab",
					"aria-selected": String(tab.id === this.activeTab),
				},
			});
			btn.style.padding = "3px 12px";
			btn.style.fontSize = "0.85em";
			btn.style.borderRadius = "4px";
			btn.style.border = "none";
			btn.style.cursor = "pointer";
			btn.style.background = tab.id === this.activeTab
				? "var(--interactive-accent)"
				: "transparent";
			btn.style.color = tab.id === this.activeTab
				? "var(--text-on-accent)"
				: "var(--text-muted)";
			btn.style.fontWeight = tab.id === this.activeTab ? "600" : "400";
			btn.style.transition = "all 0.15s ease";
			btn.addEventListener("click", () => {
				this.showTab(tab.id);
			});
		}
	}

	private showTab(tab: SidebarTab): void {
		this.activeTab = tab;
		this.renderTabs();
		if (tab === "sync") {
			this.syncContent.style.display = "flex";
			this.logContent.style.display = "none";
		} else {
			this.syncContent.style.display = "none";
			this.logContent.style.display = "flex";
			void this.refreshLogTab();
		}
	}

	// ═══════════════════════════════════════
	//  Sync Tab
	// ═══════════════════════════════════════

	private buildSyncTab(): void {
		this.syncContent = this.contentContainer.createDiv("syncit-sync-tab");
		this.syncContent.setAttr("role", "tabpanel");
		this.syncContent.setAttr("aria-label", "Sync");
		this.syncContent.style.display = "flex";
		this.syncContent.style.flexDirection = "column";
		this.syncContent.style.flex = "1 1 auto";
		this.syncContent.style.height = "100%";
		this.syncContent.style.minHeight = "0";
		this.syncContent.style.overflow = "hidden";

		// Status section
		const statusSection = this.syncContent.createDiv("syncit-sidebar-status");
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

		// Main sync content is the single scroll owner for the normal Sync tab.
		this.syncScrollContainer = this.syncContent.createDiv("syncit-sync-scroll");
		this.syncScrollContainer.setAttr("aria-label", "Sync content (scrollable)");
		this.syncScrollContainer.style.flex = "1 1 auto";
		this.syncScrollContainer.style.minHeight = "0";
		this.syncScrollContainer.style.overflowX = "hidden";
		this.syncScrollContainer.style.overflowY = "auto";

		// Actions section
		const actionsSection = this.syncScrollContainer.createDiv("syncit-sidebar-actions");
		actionsSection.style.padding = "12px 16px";
		actionsSection.style.display = "flex";
		actionsSection.style.flexDirection = "column";
		actionsSection.style.gap = "8px";
		actionsSection.style.flex = "0 0 auto";

		const modeRow = actionsSection.createDiv("syncit-mode-selector-row");
		modeRow.style.display = "flex";
		modeRow.style.alignItems = "center";
		modeRow.style.gap = "8px";

		const modeLabel = modeRow.createEl("span");
		modeLabel.style.fontSize = "0.85em";
		modeLabel.style.color = "var(--text-muted)";
		modeLabel.setText("Mode");

		const modeSelect = modeRow.createEl("select") as HTMLSelectElement;
		modeSelect.addClass("syncit-dropdown");
		modeSelect.style.flex = "1";
		const modes: Array<{ value: ReconciliationMode; label: string; icon: string }> = [
			{ value: "two-way", label: "Two-way sync", icon: "↕" },
			{ value: "upload-only", label: "Upload only", icon: "↑" },
			{ value: "download-only", label: "Download only", icon: "↓" },
		];
		for (const mode of modes) {
			modeSelect.createEl("option", { value: mode.value, text: `${mode.icon} ${mode.label}` });
		}
		modeSelect.value = this.selectedMode;
		modeSelect.addEventListener("change", () => {
			this.selectedMode = modeSelect.value as ReconciliationMode;
		});

		const btnRow = actionsSection.createDiv("syncit-action-buttons");
		btnRow.style.display = "flex";
		btnRow.style.gap = "8px";

		this.syncBtn = btnRow.createEl("button", { text: "Sync" });
		this.syncBtn.style.flex = "1";
		this.syncBtn.addClass("mod-cta");
		this.syncBtn.addEventListener("click", () => {
			this.plugin.performSync(this.selectedMode);
		});

		const dryRunBtn = btnRow.createEl("button", { text: "Dry Run" });
		dryRunBtn.style.flex = "1";
		dryRunBtn.addEventListener("click", () => {
			this.plugin.performDryRun(this.selectedMode);
		});

		const secondaryRow = actionsSection.createDiv("syncit-secondary-actions");
		secondaryRow.style.display = "flex";
		secondaryRow.style.gap = "8px";
		secondaryRow.style.marginTop = "4px";

		const rebuildBtn = secondaryRow.createEl("button", { text: "Rebuild Index" });
		rebuildBtn.style.flex = "1";
		rebuildBtn.style.fontSize = "0.85em";
		rebuildBtn.addEventListener("click", () => this.plugin.rebuildIndex());

		// Real-time sync log section
		this.logSection = this.syncScrollContainer.createDiv("syncit-sidebar-log");
		this.logSection.style.padding = "12px 16px";
		this.logSection.style.borderTop = "1px solid var(--background-modifier-border)";
		this.logSection.style.display = "flex";
		this.logSection.style.flexDirection = "column";
		this.logSection.style.flex = "0 0 auto";
		this.logSection.style.minHeight = "0";
		this.logSection.style.overflow = "visible";

		this.logHeaderEl = this.logSection.createEl("div");
		this.logHeaderEl.style.fontSize = "0.75em";
		this.logHeaderEl.style.color = "var(--text-faint)";
		this.logHeaderEl.style.marginBottom = "6px";
		this.logHeaderEl.setText("Recent Activity");

		this.logListEl = this.logSection.createDiv();
		this.logListEl.style.flex = "0 0 auto";
		this.logListEl.style.display = "flex";
		this.logListEl.style.flexDirection = "column";
		this.logListEl.style.gap = "3px";
		this.logListEl.style.fontSize = "0.85em";

		// Connection info
		const infoSection = this.syncContent.createDiv("syncit-sidebar-info");
		infoSection.style.padding = "12px 16px";
		infoSection.style.fontSize = "0.8em";
		infoSection.style.color = "var(--text-muted)";
		infoSection.style.borderTop = "1px solid var(--background-modifier-border)";
		infoSection.style.flex = "0 0 auto";

		const url = this.plugin.settings.webdavUrl || "Not configured";
		infoSection.createEl("div", { text: `Server: ${url}` });
	}

	// ═══════════════════════════════════════
	//  Log Tab
	// ═══════════════════════════════════════

	private buildLogTab(): void {
		this.logContent = this.contentContainer.createDiv("syncit-log-tab");
		this.logContent.setAttr("role", "tabpanel");
		this.logContent.setAttr("aria-label", "Log");
		this.logContent.style.display = "none";
		this.logContent.style.flexDirection = "column";
		this.logContent.style.flex = "1 1 auto";
		this.logContent.style.height = "100%";
		this.logContent.style.minHeight = "0";
		this.logContent.style.overflow = "hidden";

		// Filter bar
		const filterBar = this.logContent.createDiv("syncit-log-filters");
		filterBar.style.padding = "8px 16px";
		filterBar.style.borderBottom = "1px solid var(--background-modifier-border)";
		filterBar.style.display = "flex";
		filterBar.style.flexWrap = "wrap";
		filterBar.style.gap = "4px";

		const filters: Array<{ value: LogFilter; label: string }> = [
			{ value: "ALL", label: "All" },
			{ value: "ERROR", label: "Error" },
			{ value: "WARNING", label: "Warning" },
			{ value: "INFO", label: "Info" },
			{ value: "DEBUG", label: "Debug" },
		];

		for (const f of filters) {
			const btn = filterBar.createEl("button");
			btn.setText(f.label);
			btn.style.padding = "3px 10px";
			btn.style.fontSize = "0.8em";
			btn.style.borderRadius = "4px";
			btn.style.border = "1px solid var(--background-modifier-border)";
			btn.style.background = "var(--background-primary)";
			btn.style.cursor = "pointer";
			btn.addEventListener("click", () => this.setLogFilter(f.value));
			this.logFilterBtns.set(f.value, btn);
		}

		// Search row
		const searchRow = this.logContent.createDiv("syncit-log-search");
		searchRow.style.padding = "8px 16px";
		searchRow.style.borderBottom = "1px solid var(--background-modifier-border)";
		searchRow.style.display = "flex";
		searchRow.style.gap = "8px";

		this.logSearchInput = searchRow.createEl("input");
		this.logSearchInput.type = "text";
		this.logSearchInput.placeholder = "Search logs...";
		this.logSearchInput.style.flex = "1";
		this.logSearchInput.addClass("syncit-log-search-input");
		this.logSearchInput.addEventListener("input", () => {
			this.logSearchQuery = this.logSearchInput!.value;
			void this.refreshLogTab();
		});

		const clearBtn = searchRow.createEl("button");
		clearBtn.setText("Clear");
		clearBtn.addClass("mod-warning");
		clearBtn.style.fontSize = "0.8em";
		clearBtn.addEventListener("click", () => {
			if (confirm("Clear all sync logs? This cannot be undone.")) {
				void this.plugin.logger?.clear().then(() => {
					new Notice("Sync log cleared");
					void this.refreshLogTab();
				});
			}
		});

		// Log list
		this.logListContainer = this.logContent.createDiv("syncit-log-list");
		this.logListContainer.setAttr("aria-label", "Sync log entries (scrollable)");
		this.logListContainer.style.flex = "1 1 auto";
		this.logListContainer.style.minHeight = "0";
		this.logListContainer.style.overflowY = "auto";
		this.logListContainer.style.padding = "8px 16px";
		this.logListContainer.style.scrollbarGutter = "stable";

		this.logFooterEl = this.logContent.createDiv("syncit-log-footer");
		this.logFooterEl.style.flex = "0 0 auto";
		this.logFooterEl.style.padding = "8px 16px";
		this.logFooterEl.style.borderTop = "1px solid var(--background-modifier-border)";
		this.logFooterEl.style.fontSize = "0.75em";
		this.logFooterEl.style.color = "var(--text-muted)";
		this.logFooterEl.setText("No log entries loaded");

		this.updateLogFilterButtons();
	}

	private setLogFilter(filter: LogFilter): void {
		this.logFilter = filter;
		this.updateLogFilterButtons();
		void this.refreshLogTab();
	}

	private updateLogFilterButtons(): void {
		for (const [value, btn] of this.logFilterBtns) {
			const isActive = value === this.logFilter;
			btn.style.background = isActive ? "var(--interactive-accent)" : "var(--background-primary)";
			btn.style.color = isActive ? "var(--text-on-accent)" : "var(--text-normal)";
			btn.style.borderColor = isActive ? "var(--interactive-accent)" : "var(--background-modifier-border)";
			btn.style.fontWeight = isActive ? "600" : "400";
		}
	}

	private async refreshLogTab(): Promise<void> {
		if (!this.logListContainer || !this.plugin.logger) return;

		const entries = await this.plugin.logger.readEntries({
			level: this.logFilter === "ALL" ? undefined : this.logFilter,
			search: this.logSearchQuery || undefined,
			limit: 500,
		});

		this.logListContainer.empty();

		if (entries.length === 0) {
			this.logFooterEl?.setText("No matching log entries");
			const empty = this.logListContainer.createEl("div");
			empty.style.textAlign = "center";
			empty.style.padding = "40px 20px";
			empty.style.color = "var(--text-muted)";
			empty.setText("No log entries");
			return;
		}
		this.logFooterEl?.setText(`Showing ${entries.length} entr${entries.length === 1 ? "y" : "ies"} · Auto-refresh every 3s`);

		const groups = this.groupBySession(entries);

		for (const group of groups) {
			const sessionEl = this.logListContainer.createDiv("syncit-log-session");
			sessionEl.style.marginBottom = "12px";
			sessionEl.style.border = "1px solid var(--background-modifier-border)";
			sessionEl.style.borderRadius = "6px";
			sessionEl.style.overflow = "hidden";

			const sessionHeader = sessionEl.createDiv("syncit-log-session-header");
			sessionHeader.style.padding = "8px 12px";
			sessionHeader.style.background = "var(--background-primary-alt)";
			sessionHeader.style.cursor = "pointer";
			sessionHeader.style.display = "flex";
			sessionHeader.style.alignItems = "center";
			sessionHeader.style.gap = "8px";

			const startTime = new Date(group.startTime);
			const timeStr = startTime.toLocaleString();
			const entryCount = group.entries.length;

			const expandIcon = sessionHeader.createEl("span");
			expandIcon.setText("▼");
			expandIcon.style.fontSize = "0.8em";
			expandIcon.style.transition = "transform 0.2s";

			const title = sessionHeader.createEl("span");
			title.style.fontWeight = "600";
			title.style.fontSize = "0.9em";
			title.setText(`Session · ${timeStr}`);

			const countBadge = sessionHeader.createEl("span");
			countBadge.style.fontSize = "0.75em";
			countBadge.style.padding = "1px 6px";
			countBadge.style.borderRadius = "8px";
			countBadge.style.background = "var(--background-modifier-border)";
			countBadge.setText(String(entryCount));

			const levelCounts = this.countLevels(group.entries);
			const levelSummary = sessionHeader.createEl("span");
			levelSummary.style.marginLeft = "auto";
			levelSummary.style.fontSize = "0.75em";
			levelSummary.style.display = "flex";
			levelSummary.style.gap = "4px";

			for (const [level, count] of Object.entries(levelCounts)) {
				if (count === 0) continue;
				const badge = levelSummary.createEl("span");
				badge.style.padding = "1px 5px";
				badge.style.borderRadius = "3px";
				badge.style.fontSize = "0.7em";
				badge.style.fontWeight = "600";
				const colors = this.getLevelColors(level as LogLevel);
				badge.style.background = colors.bg;
				badge.style.color = colors.fg;
				badge.setText(`${level}: ${count}`);
			}

			const entriesContainer = sessionEl.createDiv("syncit-log-session-entries");
			entriesContainer.style.padding = "4px 0";

			for (const entry of group.entries) {
				this.renderLogEntry(entriesContainer, entry);
			}

			let expanded = true;
			sessionHeader.addEventListener("click", () => {
				expanded = !expanded;
				entriesContainer.style.display = expanded ? "block" : "none";
				expandIcon.style.transform = expanded ? "rotate(0deg)" : "rotate(-90deg)";
			});
		}
	}

	private renderLogEntry(container: HTMLElement, entry: LogEntry): void {
		const row = container.createDiv("syncit-log-entry");
		row.style.padding = "6px 12px";
		row.style.borderBottom = "1px solid var(--background-modifier-border-hover)";
		row.style.display = "flex";
		row.style.alignItems = "flex-start";
		row.style.gap = "8px";

		const levelBadge = row.createEl("span");
		levelBadge.setText(entry.level);
		levelBadge.style.fontSize = "0.65em";
		levelBadge.style.fontWeight = "700";
		levelBadge.style.padding = "2px 6px";
		levelBadge.style.borderRadius = "3px";
		levelBadge.style.whiteSpace = "nowrap";
		levelBadge.style.flex = "0 0 auto";
		const colors = this.getLevelColors(entry.level);
		levelBadge.style.background = colors.bg;
		levelBadge.style.color = colors.fg;

		const content = row.createDiv();
		content.style.flex = "1";
		content.style.minWidth = "0";

		const meta = content.createEl("div");
		meta.style.fontSize = "0.75em";
		meta.style.color = "var(--text-muted)";
		meta.style.marginBottom = "2px";
		const timeStr = new Date(entry.timestamp).toLocaleTimeString();
		meta.setText(`${timeStr} · ${entry.category}`);

		const message = content.createEl("div");
		message.style.fontSize = "0.85em";
		message.style.wordBreak = "break-word";
		message.setText(entry.message);

		if (entry.details && Object.keys(entry.details).length > 0) {
			const detailsBtn = content.createEl("button");
			detailsBtn.setText("Details");
			detailsBtn.style.fontSize = "0.75em";
			detailsBtn.style.padding = "2px 8px";
			detailsBtn.style.marginTop = "4px";
			detailsBtn.style.border = "1px solid var(--background-modifier-border)";
			detailsBtn.style.background = "var(--background-primary)";
			detailsBtn.style.borderRadius = "4px";
			detailsBtn.style.cursor = "pointer";

			const detailsEl = content.createEl("pre");
			detailsEl.style.display = "none";
			detailsEl.style.fontSize = "0.75em";
			detailsEl.style.background = "var(--background-primary-alt)";
			detailsEl.style.padding = "8px";
			detailsEl.style.borderRadius = "4px";
			detailsEl.style.marginTop = "4px";
			detailsEl.style.overflowX = "auto";
			detailsEl.setText(JSON.stringify(entry.details, null, 2));

			detailsBtn.addEventListener("click", () => {
				const isVisible = detailsEl.style.display === "block";
				detailsEl.style.display = isVisible ? "none" : "block";
				detailsBtn.setText(isVisible ? "Details" : "Hide");
			});
		}
	}

	private groupBySession(entries: LogEntry[]): { startTime: string; entries: LogEntry[] }[] {
		if (entries.length === 0) return [];
		const groups: { startTime: string; entries: LogEntry[] }[] = [];
		let current: LogEntry[] = [];
		let lastTime = new Date(entries[0].timestamp).getTime();
		for (const entry of entries) {
			const entryTime = new Date(entry.timestamp).getTime();
			if (entryTime - lastTime > 5 * 60 * 1000) {
				if (current.length > 0) groups.push({ startTime: current[0].timestamp, entries: current });
				current = [];
			}
			current.push(entry);
			lastTime = entryTime;
		}
		if (current.length > 0) groups.push({ startTime: current[0].timestamp, entries: current });
		return groups;
	}

	private countLevels(entries: LogEntry[]): Record<LogLevel, number> {
		const counts: Record<string, number> = { ERROR: 0, WARNING: 0, INFO: 0, DEBUG: 0 };
		for (const e of entries) counts[e.level] = (counts[e.level] ?? 0) + 1;
		return counts as Record<LogLevel, number>;
	}

	private getLevelColors(level: LogLevel): { bg: string; fg: string } {
		switch (level) {
			case "ERROR": return { bg: "rgba(var(--color-red-rgb), 0.15)", fg: "var(--color-red)" };
			case "WARNING": return { bg: "rgba(var(--color-orange-rgb), 0.15)", fg: "var(--color-orange)" };
			case "INFO": return { bg: "rgba(var(--color-blue-rgb), 0.12)", fg: "var(--color-blue)" };
			case "DEBUG": return { bg: "var(--background-modifier-border)", fg: "var(--text-muted)" };
		}
	}

	// ═══════════════════════════════════════
	//  Shared
	// ═══════════════════════════════════════

	updateSyncMode() {
		this.selectedMode = this.plugin.settings.syncDirection;
	}

	private openSettings() {
		// @ts-ignore
		this.app.setting.open();
		// @ts-ignore
		this.app.setting.openTabById(this.plugin.manifest.id);
	}

	switchToLogTab(): void {
		this.showTab("log");
	}

	// ─── Progress API ───

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

	setReconciliationRequired(plan: SyncPlan) {
		this.isSyncing = false;
		this.currentPlan = plan;
		this.statusEl.setText("Reconciliation required");
		this.lastSyncEl.setText(`${plan.reconciliation.length} file(s) need a decision before syncing`);
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
		const container = this.syncScrollContainer;
		const actionsSection = container.querySelector(".syncit-sidebar-actions") as HTMLElement | null;
		if (!actionsSection) return;

		this.reconciliationSection = container.createDiv("syncit-sidebar-reconciliation");
		this.reconciliationSection.setAttr("aria-label", "Reconciliation review");
		this.reconciliationSection.style.padding = "0 16px 12px";
		this.reconciliationSection.style.display = "flex";
		this.reconciliationSection.style.flexDirection = "column";
		this.reconciliationSection.style.flex = "1 1 auto";
		this.reconciliationSection.style.minHeight = "0";
		this.reconciliationSection.style.overflow = "hidden";
		container.insertBefore(this.reconciliationSection, actionsSection);
		actionsSection.style.display = "none";
		if (this.logSection) this.logSection.style.display = "none";
		this.syncScrollContainer.style.overflowY = "hidden";

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
		for (const mode of modes) modeSelect.createEl("option", { value: mode.value, text: mode.label });

		const itemList = this.reconciliationSection.createDiv();
		itemList.setAttr("aria-label", "Reconciliation files (scrollable)");
		itemList.style.flex = "1 1 auto";
		itemList.style.minHeight = "0";
		itemList.style.overflowY = "auto";
		itemList.style.scrollbarGutter = "stable";
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
		for (const select of itemSelects.values()) select.addEventListener("change", updateApplyState);
		modeSelect.addEventListener("change", () => {
			const decision = modeSelect.value === "upload-only" ? "use-local" : modeSelect.value === "download-only" ? "use-remote" : "skip";
			for (const select of itemSelects.values()) select.value = decision;
			updateApplyState();
		});
		cancelButton.addEventListener("click", () => this.plugin.cancelReconciliation());
		applyButton.addEventListener("click", () => {
			const decisions: Record<string, ReconciliationDecision> = {};
			for (const [path, select] of itemSelects) decisions[path] = select.value as ReconciliationDecision;
			this.plugin.applyReconciliation(plan, modeSelect.value as ReconciliationMode, decisions);
		});
	}

	updateProgress(current: number, total: number, operation: string, path: string, bytesTransferred: number, totalBytes: number) {
		this.completedOps = current;
		this.transferredBytes = bytesTransferred;
		this.totalBytes = totalBytes;
		this._updateProgressBar();
		const elapsed = Date.now() - this.startTime;
		this.lastSyncEl.setText(`${current} of ${total} · ${formatDuration(elapsed)}`);
		const opType = operation.includes("upload") ? "upload" :
			operation.includes("download") ? "download" :
			operation.includes("delete") ? "delete" :
			operation.includes("conflict") ? "conflict" : "upload";
		if (opType === "upload") this.uploaded++;
		else if (opType === "download") this.overwritten++;
		else if (opType === "delete") this.deleted++;
		else if (opType === "conflict") this.conflicts++;
		this._updateStats();
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
		this._removeProgressUI();
		this.syncBtn.style.display = "block";
		(this.syncBtn as HTMLButtonElement).disabled = false;
		this.syncBtn.setText("Sync");
		this._showCompletionSummary(result, elapsed);
	}

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
		const container = this.syncScrollContainer;
		const actionsSection = container.querySelector(".syncit-sidebar-actions") as HTMLElement | null;
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
		const container = this.syncScrollContainer;
		const actionsSection = container.querySelector(".syncit-sidebar-actions") as HTMLElement | null;
		if (!actionsSection) return;

		this.progressSection = container.createDiv("syncit-sidebar-progress-section");
		this.progressSection.style.padding = "0 16px 12px";
		container.insertBefore(this.progressSection, actionsSection);

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

		this.cancelBtn = this.progressSection.createEl("button", { text: "Cancel", cls: "mod-warning" });
		this.cancelBtn.style.width = "100%";
		this.cancelBtn.addEventListener("click", () => this.plugin.cancelSync());

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
			this.cancelBtn = null;
			this.statEls.clear();
		}
	}

	private _showCompletionSummary(result: SyncResult & { message: string }, elapsedMs: number) {
		const container = this.syncScrollContainer;
		const actionsSection = container.querySelector(".syncit-sidebar-actions") as HTMLElement | null;
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
		const actionsSection = this.syncContent?.querySelector(".syncit-sidebar-actions") as HTMLElement | null;
		if (actionsSection) actionsSection.style.display = "flex";
		if (this.logSection) this.logSection.style.display = "flex";
		if (this.syncScrollContainer) this.syncScrollContainer.style.overflowY = "auto";
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
		const icons: Record<string, string> = { upload: "📄", download: "🔄", delete: "🗑", conflict: "⚠️", error: "❌" };
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
		const subtitles: Record<string, string> = { upload: "Uploading", download: "Downloading", delete: "Deleting", conflict: "Conflict", error: "Failed" };
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
		const badgeLabels: Record<string, string> = { upload: "Uploaded", download: "Downloaded", delete: "Deleted", conflict: "Resolved", error: "Error" };
		const plannedLabels: Record<string, string> = { upload: "Would upload", download: "Would download", delete: "Would delete", conflict: "Would review", error: "Would fail" };
		badge.setText(isPlanned ? (plannedLabels[baseOperation] || "Would process") : (badgeLabels[baseOperation] || "Done"));
		while (this.logListEl.children.length > 50) this.logListEl.firstChild?.remove();
		this.logListEl.scrollTop = this.logListEl.scrollHeight;
	}

	private _clearLog() {
		if (this.logListEl) this.logListEl.empty();
		void this.plugin.logger?.info("ui", "Log display cleared");
	}
}

// ─── Helpers ───

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

type LogFilter = "ALL" | LogLevel;
