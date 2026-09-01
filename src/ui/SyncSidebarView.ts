import { ItemView, WorkspaceLeaf } from "obsidian";
import type SyncItPlugin from "../main";
import type { LogEntry, LogLevel, LogPage } from "../logging/SyncLogger";
import type {
	ReconciliationDecision,
	ReconciliationMode,
	SyncPlan,
	SyncResult,
} from "../types";

export const SYNC_SIDEBAR_VIEW_TYPE = "syncit-sidebar";

type SidebarTab = "sync" | "activity" | "errors";
type LogTimeRange = "all" | "day" | "week" | "month";

export class SyncSidebarView extends ItemView {
	private readonly plugin: SyncItPlugin;
	private activeTab: SidebarTab = "sync";
	private tabsContainer!: HTMLElement;
	private contentContainer!: HTMLElement;
	private syncContent!: HTMLElement;
	private syncScroll!: HTMLElement;
	private statusEl!: HTMLElement;
	private lastSyncEl!: HTMLElement;
	private serverEl!: HTMLElement;
	private syncButton!: HTMLButtonElement;
	private dryRunButton!: HTMLButtonElement;
	private rebuildButton!: HTMLButtonElement;
	private modeButtons = new Map<ReconciliationMode, HTMLButtonElement>();
	private progressSection: HTMLElement | null = null;
	private progressFill: HTMLElement | null = null;
	private progressText: HTMLElement | null = null;
	private progressSize: HTMLElement | null = null;
	private progressList: HTMLElement | null = null;
	private progressStats = new Map<string, HTMLElement>();
	private progressCancel: HTMLButtonElement | null = null;
	private completionSection: HTMLElement | null = null;
	private reconciliationSection: HTMLElement | null = null;
	private activityContent!: HTMLElement;
	private errorsContent!: HTMLElement;
	private logRefreshInterval: ReturnType<typeof setInterval> | null = null;
	private logEntries: LogEntry[] = [];
	private logPage: LogPage | null = null;
	private logCursor: number | null = null;
	private logRequest = 0;

	private isSyncing = false;
	private startTime = 0;
	private totalOps = 0;
	private completedOps = 0;
	private totalBytes = 0;
	private transferredBytes = 0;
	private scanned = 0;
	private uploaded = 0;
	private downloaded = 0;
	private deleted = 0;
	private conflicts = 0;
	private errors = 0;
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

	async onOpen(): Promise<void> {
		const container = this.containerEl.children[1] as HTMLElement;
		container.empty();
		container.addClass("syncit-sidebar");
		container.setAttr("aria-label", "SyncIt");
		container.style.height = "100%";
		container.style.minHeight = "0";
		container.style.minWidth = "0";
		container.style.overflow = "hidden";

		const header = container.createDiv("syncit-sidebar-header");
		const titleRow = header.createDiv("syncit-title-row");
		titleRow.createEl("h2", { text: "SyncIt" });
		const settingsButton = titleRow.createEl("button", { text: "⚙", attr: { "aria-label": "Open SyncIt settings", title: "Settings" } });
		settingsButton.addEventListener("click", () => this.openSettings());

		this.tabsContainer = header.createDiv("syncit-tabs");
		this.tabsContainer.setAttr("role", "tablist");
		this.renderTabs();

		this.contentContainer = container.createDiv("syncit-content-container");
		this.buildSyncTab();
		this.buildLogTab("activity");
		this.buildLogTab("errors");
		this.showTab("sync");

		this.logRefreshInterval = setInterval(() => {
			if ((this.activeTab === "activity" || this.activeTab === "errors") && this.containerEl.isShown()) {
				void this.refreshLogView(true);
			}
		}, 3000);
	}

	async onClose(): Promise<void> {
		if (this.logRefreshInterval !== null) clearInterval(this.logRefreshInterval);
		this.logRefreshInterval = null;
	}

	private renderTabs(): void {
		this.tabsContainer.empty();
		const tabs: Array<{ id: SidebarTab; label: string; icon: string }> = [
			{ id: "sync", label: "Sync", icon: "↻" },
			{ id: "activity", label: "Activity", icon: "☷" },
			{ id: "errors", label: "Errors", icon: "⚠" },
		];
		for (const tab of tabs) {
			const button = this.tabsContainer.createEl("button", { attr: { role: "tab", "aria-selected": String(tab.id === this.activeTab) } });
			button.setText(`${tab.icon} ${tab.label}`);
			button.addEventListener("click", () => this.showTab(tab.id));
		}
	}

	private showTab(tab: SidebarTab): void {
		this.activeTab = tab;
		this.renderTabs();
		this.syncContent.style.display = tab === "sync" ? "flex" : "none";
		this.activityContent.style.display = tab === "activity" ? "flex" : "none";
		this.errorsContent.style.display = tab === "errors" ? "flex" : "none";
		if (tab === "activity" || tab === "errors") void this.refreshLogView(false);
	}

	private buildSyncTab(): void {
		this.syncContent = this.contentContainer.createDiv("syncit-sync-tab");
		this.syncContent.setAttr("role", "tabpanel");
		this.syncContent.setAttr("aria-label", "Sync");

		const statusCard = this.syncContent.createDiv("syncit-status-card");
		const statusTop = statusCard.createDiv("syncit-status-top");
		const statusDot = statusTop.createEl("span", { text: "●", cls: "syncit-status-dot" });
		statusDot.setAttr("aria-hidden", "true");
		const statusText = statusTop.createDiv();
		this.statusEl = statusText.createEl("strong", { text: "Ready" });
		this.lastSyncEl = statusText.createEl("span", { text: "Never synced" });
		const statusMark = statusTop.createEl("span", { text: "✓", cls: "syncit-status-check" });
		statusMark.setAttr("aria-label", "Connection ready");

		this.syncScroll = this.syncContent.createDiv("syncit-sync-scroll");
		this.syncScroll.style.flex = "1 1 auto";
		this.syncScroll.style.minHeight = "0";
		this.syncScroll.style.maxHeight = "none";
		this.syncScroll.style.overflowY = "auto";
		this.syncScroll.style.overflowX = "hidden";
		const directionCard = this.syncScroll.createDiv("syncit-card syncit-direction-card");
		directionCard.createEl("h3", { text: "Sync direction" });
		const modeGroup = directionCard.createDiv("syncit-mode-group");
		modeGroup.setAttr("role", "radiogroup");
		const modes: Array<{ value: ReconciliationMode; label: string }> = [
			{ value: "download-only", label: "↓ Download" },
			{ value: "two-way", label: "↔ Bidirectional" },
			{ value: "upload-only", label: "↑ Upload" },
		];
		for (const mode of modes) {
			const button = modeGroup.createEl("button", { text: mode.label, attr: { role: "radio" } }) as HTMLButtonElement;
			this.modeButtons.set(mode.value, button);
			button.addEventListener("click", () => {
				this.selectedMode = mode.value;
				this.updateModeButtons();
			});
		}
		this.updateModeButtons();

		const summary = directionCard.createDiv("syncit-file-summary");
		summary.createEl("h3", { text: "Files to sync" });
		this.createSummaryRow(summary, "New on this device", "new-local");
		this.createSummaryRow(summary, "Updated on this device", "upload");
		this.createSummaryRow(summary, "New on remote", "new-remote");
		this.createSummaryRow(summary, "Updated on remote", "download");
		this.createSummaryRow(summary, "Conflicts detected", "conflict");

		const advanced = directionCard.createEl("details", { cls: "syncit-advanced" });
		advanced.createEl("summary", { text: "Advanced options" });
		const advancedText = advanced.createEl("p", { text: "Reconciliation policy and retention settings are available in SyncIt Settings." });
		advancedText.addClass("setting-item-description");

		const recent = this.syncScroll.createDiv("syncit-card syncit-recent-card");
		recent.createEl("h3", { text: "Recent activity" });
		this.renderRecentActivity(recent);

		const actionBar = this.syncContent.createDiv("syncit-action-bar");
		this.syncButton = actionBar.createEl("button", { text: "↻  Sync", cls: "mod-cta" }) as HTMLButtonElement;
		this.syncButton.addEventListener("click", () => this.plugin.performSync(this.selectedMode));
		this.dryRunButton = actionBar.createEl("button", { text: "Dry run" }) as HTMLButtonElement;
		this.dryRunButton.addEventListener("click", () => this.plugin.performDryRun(this.selectedMode));
		this.rebuildButton = this.syncContent.createEl("button", { text: "Rebuild index", cls: "syncit-rebuild-button" }) as HTMLButtonElement;
		this.rebuildButton.addEventListener("click", () => this.plugin.rebuildIndex());

		const footer = this.syncContent.createDiv("syncit-sidebar-info");
		this.serverEl = footer.createEl("span", { text: "☁  Server: Not configured" });
		footer.createEl("span", { text: "●", cls: "syncit-server-dot" });
		this.updateServerText();
	}

	private createSummaryRow(parent: HTMLElement, label: string, key: string): void {
		const row = parent.createDiv("syncit-summary-row");
		row.createEl("span", { text: label });
		const value = row.createEl("strong", { text: "0" });
		value.dataset.summaryKey = key;
	}

	private updateSummary(plan: SyncPlan): void {
		const values: Record<string, number> = {
			"new-local": plan.uploads.length,
			upload: plan.uploads.length,
			"new-remote": plan.downloads.length,
			download: plan.downloads.length,
			conflict: plan.conflicts.length + plan.reconciliation.length,
		};
		for (const element of Array.from(this.syncScroll.querySelectorAll<HTMLElement>("[data-summary-key]"))) {
			const key = element.dataset.summaryKey ?? "";
			element.setText(String(values[key] ?? 0));
		}
	}

	private updateServerText(): void {
		if (this.serverEl) this.serverEl.setText(`☁  Server: ${this.plugin.settings.webdavUrl || "Not configured"}`);
	}

	private updateModeButtons(): void {
		for (const [mode, button] of this.modeButtons) {
			const selected = mode === this.selectedMode;
			button.setAttr("aria-checked", String(selected));
			button.toggleClass("is-selected", selected);
		}
	}

	private renderRecentActivity(parent: HTMLElement): void {
		const list = parent.createDiv("syncit-recent-list");
		void this.plugin.logger?.readPage({ limit: 4 }).then((page) => {
			list.empty();
			if (page.entries.length === 0) {
				list.createEl("p", { text: "No sync activity yet." }).addClass("setting-item-description");
				return;
			}
			for (const entry of page.entries.slice(0, 4)) this.renderCompactEntry(list, entry);
		});
	}

	private renderCompactEntry(parent: HTMLElement, entry: LogEntry): void {
		const row = parent.createDiv("syncit-recent-row");
		const icon = entry.level === "ERROR" ? "⚠" : entry.level === "WARNING" ? "△" : "✓";
		row.createEl("span", { text: icon, cls: `syncit-level-${entry.level.toLowerCase()}` });
		const text = row.createDiv();
		text.createEl("span", { text: entry.message });
		text.createEl("small", { text: new Date(entry.timestamp).toLocaleTimeString() });
	}

	private buildLogTab(tab: "activity" | "errors"): void {
		const content = this.contentContainer.createDiv(`syncit-log-tab syncit-${tab}-tab`);
		content.setAttr("role", "tabpanel");
		content.setAttr("aria-label", tab === "errors" ? "Errors" : "Activity");
		content.style.display = "none";
		if (tab === "activity") this.activityContent = content; else this.errorsContent = content;

		const heading = content.createDiv("syncit-log-heading");
		heading.createEl("h2", { text: tab === "errors" ? "Errors" : "Activity" });
		heading.createEl("p", { text: tab === "errors" ? "Failed file operations from sync runs." : "Sync sessions and operations, newest first." });

		const filters = content.createDiv("syncit-log-filters");
		const search = filters.createEl("input", { attr: { type: "search", placeholder: "Search logs…", "aria-label": "Search logs", "data-log-control": "search" } }) as HTMLInputElement;
		const category = filters.createEl("input", { attr: { type: "search", placeholder: "Category", "aria-label": "Filter by category", "data-log-control": "category" } }) as HTMLInputElement;
		const session = filters.createEl("select", { attr: { "aria-label": "Filter by session", "data-log-control": "session" } }) as HTMLSelectElement;
		session.createEl("option", { value: "", text: "All sessions" });
		const level = filters.createEl("select", { attr: { "aria-label": "Filter by level", "data-log-control": "level" } }) as HTMLSelectElement;
		for (const option of [{ value: "", text: "All levels" }, { value: "ERROR", text: "Errors" }, { value: "WARNING", text: "Warnings" }, { value: "INFO", text: "Info" }, { value: "DEBUG", text: "Debug" }]) level.createEl("option", option);
		const timeRange = filters.createEl("select", { attr: { "aria-label": "Filter by time", "data-log-control": "time" } }) as HTMLSelectElement;
		for (const option of [{ value: "all", text: "Any time" }, { value: "day", text: "Last 24 hours" }, { value: "week", text: "Last 7 days" }, { value: "month", text: "Last 30 days" }]) timeRange.createEl("option", option);
		search.addEventListener("input", () => void this.refreshLogView(false));
		category.addEventListener("input", () => void this.refreshLogView(false));
		session.addEventListener("change", () => void this.refreshLogView(false));
		level.addEventListener("change", () => void this.refreshLogView(false));
		timeRange.addEventListener("change", () => void this.refreshLogView(false));

		const list = content.createDiv("syncit-log-list");
		list.setAttr("aria-label", "Log entries (scrollable)");
		const footer = content.createDiv("syncit-log-footer");
		const loadMore = footer.createEl("button", { text: "Load older", attr: { "data-log-load-more": "true" } }) as HTMLButtonElement;
		loadMore.addEventListener("click", () => void this.loadOlderLogs());
		footer.createEl("span", { text: "No entries loaded", cls: "syncit-log-count" });
		if (tab === "errors") level.value = "ERROR";
	}

	private logCountEl(): HTMLElement {
		return this.getLogSurface().querySelector(".syncit-log-count") as HTMLElement;
	}

	private getLogSurface(): HTMLElement {
		return this.activeTab === "errors" ? this.errorsContent : this.activityContent;
	}

	private getLogControl<T extends HTMLElement>(name: string): T {
		return this.getLogSurface().querySelector(`[data-log-control="${name}"]`) as T;
	}

	private async refreshLogView(preserveScroll: boolean): Promise<void> {
		const logger = this.plugin.logger;
		if (!logger) return;
		const list = this.getLogSurface().querySelector(".syncit-log-list") as HTMLElement | null;
		if (!list) return;
		const request = ++this.logRequest;
		const scrollTop = preserveScroll ? list.scrollTop : 0;
		const page = await logger.readPage(this.logQuery());
		if (request !== this.logRequest) return;
		this.logPage = page;
		this.logCursor = page.nextCursor;
		this.logEntries = page.entries;
		this.updateSessionOptions(page.entries);
		this.renderLogEntries();
		if (preserveScroll) list.scrollTop = scrollTop;
	}

	private logQuery(cursor?: number) {
		const search = this.getLogControl<HTMLInputElement>("search");
		const category = this.getLogControl<HTMLInputElement>("category");
		const session = this.getLogControl<HTMLSelectElement>("session");
		const level = this.getLogControl<HTMLSelectElement>("level");
		const timeRange = this.getLogControl<HTMLSelectElement>("time");
		const range = timeRange?.value as LogTimeRange | undefined;
		const now = Date.now();
		const duration = range === "day" ? 1 : range === "week" ? 7 : range === "month" ? 30 : 0;
		return {
			level: this.activeTab === "errors" ? "ERROR" as LogLevel : (level?.value || undefined) as LogLevel | undefined,
			category: category?.value.trim() || undefined,
			search: search?.value.trim() || undefined,
			session: session?.value || undefined,
			from: duration ? new Date(now - duration * 24 * 60 * 60 * 1000).toISOString() : undefined,
			limit: 50,
			cursor,
		};
	}

	private updateSessionOptions(entries: LogEntry[]): void {
		const session = this.getLogControl<HTMLSelectElement>("session");
		if (!session) return;
		const current = session.value;
		const sessions = Array.from(new Set(entries.map((entry) => String(entry.details?.sessionId ?? "")).filter(Boolean)));
		session.empty();
		session.createEl("option", { value: "", text: "All sessions" });
		for (const sessionId of sessions) session.createEl("option", { value: sessionId, text: `Session ${sessionId.slice(11, 19)}` });
		session.value = sessions.includes(current) ? current : "";
	}

	private renderLogEntries(): void {
		const list = this.getLogSurface().querySelector(".syncit-log-list") as HTMLElement | null;
		if (!list) return;
		list.empty();
		if (this.logEntries.length === 0) {
			list.createDiv("syncit-log-empty").setText(this.logPage?.parseErrors ? "No valid entries. Some log lines could not be read." : "No matching entries.");
		} else {
			for (const entry of this.logEntries) this.renderLogEntry(entry);
		}
		const page = this.logPage;
		const suffix = page?.parseErrors ? ` · ${page.parseErrors} unreadable` : "";
		this.logCountEl().setText(`${page?.matchingEntries ?? 0} matching · ${page?.totalEntries ?? 0} total${suffix}`);
		const loadMore = this.getLogSurface().querySelector("[data-log-load-more]") as HTMLElement | null;
		if (loadMore) loadMore.style.display = page?.nextCursor === null ? "none" : "inline-flex";
	}

	private renderLogEntry(entry: LogEntry): void {
		const list = this.getLogSurface().querySelector(".syncit-log-list") as HTMLElement | null;
		if (!list) return;
		const row = list.createDiv("syncit-log-row");
		row.setAttr("tabindex", "0");
		const meta = row.createDiv("syncit-log-meta");
		meta.createEl("time", { text: new Date(entry.timestamp).toLocaleString() });
		meta.createEl("span", { text: entry.level, cls: `syncit-level-badge syncit-level-${entry.level.toLowerCase()}` });
		meta.createEl("span", { text: entry.category, cls: "syncit-log-category" });
		const body = row.createDiv("syncit-log-body");
		const operation = typeof entry.details?.operation === "string" ? ` · ${entry.details.operation}` : "";
		const path = typeof entry.details?.path === "string" ? ` · ${entry.details.path}` : "";
		body.createEl("strong", { text: `${entry.message}${operation}${path}` });
		const details = Object.fromEntries(Object.entries(entry.details ?? {}).filter(([key]) => !/password|passwd|token|secret|authorization|api[-_]?key/i.test(key)));
		if (Object.keys(details).length > 0) {
			const disclosure = body.createEl("details");
			disclosure.createEl("summary", { text: "View details" });
			disclosure.createEl("pre", { text: JSON.stringify(details, null, 2) });
		}
	}

	private async loadOlderLogs(): Promise<void> {
		if (this.logCursor === null || !this.plugin.logger) return;
		const page = await this.plugin.logger.readPage(this.logQuery(this.logCursor));
		this.logCursor = page.nextCursor;
		this.logPage = {
			...page,
			entries: [...this.logEntries, ...page.entries],
	};
		this.logEntries = this.logPage.entries;
		this.renderLogEntries();
	}

	updateSyncMode(): void {
		this.selectedMode = this.plugin.settings.syncDirection;
		this.updateModeButtons();
		this.updateServerText();
	}

	private openSettings(): void {
		// @ts-ignore Obsidian's setting API is not in the public type surface.
		this.app.setting.open();
		// @ts-ignore Obsidian's setting API is not in the public type surface.
		this.app.setting.openTabById(this.plugin.manifest.id);
	}

	switchToLogTab(): void { this.showTab("activity"); }

	setPlan(plan: SyncPlan): void {
		this.isSyncing = true;
		this.currentPlan = plan;
		this.startTime = Date.now();
		this.totalOps = plan.uploads.length + plan.downloads.length + plan.localDeletes.length + plan.conflicts.length + plan.remoteDeletes.length;
		this.completedOps = 0;
		this.totalBytes = plan.uploadSize + plan.downloadSize;
		this.transferredBytes = 0;
		this.scanned = this.totalOps + plan.unchanged + plan.reconciliation.length;
		this.uploaded = 0;
		this.downloaded = 0;
		this.deleted = 0;
		this.conflicts = 0;
		this.errors = 0;
		this.statusEl.setText("Syncing…");
		this.lastSyncEl.setText(`${this.totalOps} operations planned`);
		this.updateSummary(plan);
		this.removeCompletion();
		this.removeReconciliation();
		this.syncButton.style.display = "none";
		this.dryRunButton.style.display = "none";
		this.ensureProgress();
		this.updateProgressBar();
		this.updateProgressStats();
	}

	setReconciliationRequired(plan: SyncPlan): void {
		this.isSyncing = false;
		this.currentPlan = plan;
		this.statusEl.setText("Reconciliation required");
		this.lastSyncEl.setText(`${plan.reconciliation.length} file(s) need a decision`);
		this.removeProgress();
		this.removeCompletion();
		this.renderReconciliation(plan);
		this.syncButton.style.display = "none";
		this.dryRunButton.style.display = "none";
	}

	private renderReconciliation(plan: SyncPlan): void {
		this.removeReconciliation();
		this.syncScroll.style.display = "none";
		this.reconciliationSection = this.syncContent.createDiv("syncit-reconciliation");
		const header = this.reconciliationSection.createDiv("syncit-reconciliation-header");
		header.createEl("h2", { text: "Reconciliation required" });
		header.createEl("p", { text: "These files differ or have no shared baseline. Choose an action for every row." });
		const table = this.reconciliationSection.createDiv("syncit-reconciliation-table");
		const headings = table.createDiv("syncit-reconciliation-headings");
		headings.createEl("span", { text: "File" });
		headings.createEl("span", { text: "Reason" });
		headings.createEl("span", { text: "Choose action" });
		const rows = table.createDiv("syncit-reconciliation-rows");
		const selects = new Map<string, HTMLSelectElement>();
		for (const item of plan.reconciliation) {
			const row = rows.createDiv("syncit-reconciliation-row");
			const file = row.createDiv("syncit-reconciliation-file");
			file.createEl("span", { text: item.local ? "▧" : "▱" });
			const path = file.createEl("span", { text: item.path });
			path.setAttr("title", item.path);
			const reason = row.createDiv("syncit-reconciliation-reason");
			reason.createEl("span", { text: reconciliationReasonLabel(item.reason) });
			reason.createEl("small", { text: fileSummary(item) });
			const select = row.createEl("select") as HTMLSelectElement;
			for (const option of [
				{ value: "skip", text: "Choose action" },
				{ value: "use-local", text: "Keep mine" },
				{ value: "use-remote", text: "Keep remote" },
				{ value: "keep-both", text: "Keep both" },
			]) select.createEl("option", option);
			selects.set(item.path, select);
		}
		const footer = this.reconciliationSection.createDiv("syncit-reconciliation-footer");
		const unresolved = footer.createEl("span", { text: `${plan.reconciliation.length} unresolved` });
		const buttons = footer.createDiv();
		const cancel = buttons.createEl("button", { text: "Cancel" });
		const apply = buttons.createEl("button", { text: "Apply decisions", cls: "mod-cta" }) as HTMLButtonElement;
		apply.disabled = true;
		const update = () => {
			const count = Array.from(selects.values()).filter((select) => select.value === "skip").length;
			apply.disabled = count > 0;
			unresolved.setText(`${count} unresolved`);
		};
		for (const select of selects.values()) select.addEventListener("change", update);
		cancel.addEventListener("click", () => this.plugin.cancelReconciliation());
		apply.addEventListener("click", () => {
			const decisions: Record<string, ReconciliationDecision> = {};
			for (const [path, select] of selects) decisions[path] = select.value as ReconciliationDecision;
			this.plugin.applyReconciliation(plan, this.selectedMode, decisions);
		});
	}

	updateProgress(current: number, total: number, operation: string, path: string, bytesTransferred: number, totalBytes: number): void {
		this.completedOps = current;
		this.transferredBytes = bytesTransferred;
		this.totalBytes = totalBytes;
		const isError = operation.startsWith("error:");
		const operationName = operation.split(":").pop() ?? operation;
		if (isError) this.errors++;
		else if (operationName === "upload" || operation.includes("uploading")) this.uploaded++;
		else if (operationName === "download" || operation.includes("downloading")) this.downloaded++;
		else if (operationName.includes("delete") || operation.includes("deleting")) this.deleted++;
		else if (operationName === "conflict" || operation.includes("conflict")) this.conflicts++;
		this.updateProgressBar();
		this.updateProgressStats();
		this.lastSyncEl.setText(`${current} of ${total} · ${formatDuration(Date.now() - this.startTime)}`);
		this.appendProgressRow(path, operationName, isError);
	}

	finish(result: SyncResult & { message: string }): void {
		this.isSyncing = false;
		this.removeReconciliation();
		this.removeProgress();
		this.statusEl.setText(result.errors.length > 0 ? "Completed with errors" : "Connected");
		this.lastSyncEl.setText(`${result.message} · ${formatDuration(Date.now() - this.startTime)}`);
		this.syncButton.style.display = "block";
		this.dryRunButton.style.display = "block";
		this.syncButton.disabled = false;
		this.dryRunButton.disabled = false;
		this.showCompletion(result);
		if (result.errors.length > 0) this.showTab("errors");
	}

	showDryRunResult(result: SyncResult & { message: string }): void {
		this.isSyncing = false;
		this.removeReconciliation();
		this.removeProgress();
		this.statusEl.setText("Ready");
		this.lastSyncEl.setText(`Dry run · ${result.message}`);
		this.syncButton.style.display = "block";
		this.dryRunButton.style.display = "block";
		this.showCompletion(result, true);
	}

	setCancelled(): void {
		this.isSyncing = false;
		this.removeReconciliation();
		this.removeProgress();
		this.removeCompletion();
		this.statusEl.setText("Cancelled");
		this.lastSyncEl.setText("Sync was cancelled");
		this.syncButton.style.display = "block";
		this.dryRunButton.style.display = "block";
	}

	setError(message: string): void {
		this.isSyncing = false;
		this.removeReconciliation();
		this.removeProgress();
		this.removeCompletion();
		this.statusEl.setText("Sync failed");
		this.lastSyncEl.setText(message);
		this.syncButton.style.display = "block";
		this.dryRunButton.style.display = "block";
	}

	updateStatus(status: string, lastSync?: string): void {
		if (!this.isSyncing) {
			this.statusEl.setText(status);
			if (lastSync) this.lastSyncEl.setText(`Last sync: ${lastSync}`);
		}
	}

	setSyncing(syncing: boolean): void {
		this.isSyncing = syncing;
		this.syncButton.disabled = syncing;
		this.dryRunButton.disabled = syncing;
		this.rebuildButton.disabled = syncing;
	}

	setScanning(): void {
		this.statusEl.setText("Scanning…");
		this.lastSyncEl.setText("Comparing local and remote files");
	}

	private ensureProgress(): void {
		if (this.progressSection) return;
		this.syncScroll.style.display = "flex";
		this.syncScroll.style.overflowY = "hidden";
		this.progressSection = this.syncScroll.createDiv("syncit-progress-card");
		this.progressSection.createEl("h2", { text: "Syncing vault…" });
		const bar = this.progressSection.createDiv("syncit-progress-bar");
		this.progressFill = bar.createDiv("syncit-progress-fill");
		const progressMeta = this.progressSection.createDiv("syncit-progress-meta");
		this.progressText = progressMeta.createEl("span", { text: "0%" });
		this.progressSize = progressMeta.createEl("span", { text: "0 B / 0 B" });
		const statRow = this.progressSection.createDiv("syncit-progress-stats");
		for (const [key, label] of [["processed", "Processed"], ["uploaded", "Uploaded"], ["downloaded", "Downloaded"], ["conflicts", "Conflicts"], ["errors", "Errors"]]) {
			const stat = statRow.createDiv();
			this.progressStats.set(key, stat.createEl("strong", { text: "0" }));
			stat.createEl("small", { text: label });
		}
		const filesHeading = this.progressSection.createDiv("syncit-progress-list-heading");
		filesHeading.createEl("strong", { text: "Processed files" });
		this.progressList = this.progressSection.createDiv("syncit-progress-list");
		this.progressList.setAttr("aria-label", "Processed files (scrollable)");
		this.progressCancel = this.progressSection.createEl("button", { text: "Cancel", cls: "mod-warning" }) as HTMLButtonElement;
		this.progressCancel.addEventListener("click", () => this.plugin.cancelSync());
	}

	private appendProgressRow(path: string, operation: string, error: boolean): void {
		if (!this.progressList) return;
		const row = this.progressList.createDiv("syncit-progress-row");
		row.createEl("span", { text: error ? "⚠" : operation.includes("delete") ? "▧" : "▱", cls: error ? "syncit-level-error" : "" });
		const info = row.createDiv();
		info.createEl("span", { text: path });
		info.createEl("small", { text: error ? "Error" : operation });
		const badge = row.createEl("strong", { text: error ? "Error" : operation === "download" ? "Downloaded" : operation === "upload" ? "Uploaded" : operation === "conflict" ? "Conflict" : "Done" });
		badge.addClass(error ? "syncit-progress-error" : "syncit-progress-ok");
		this.progressList.scrollTop = this.progressList.scrollHeight;
	}

	private updateProgressBar(): void {
		const pct = this.totalOps > 0 ? Math.round(this.completedOps / this.totalOps * 100) : 0;
		if (this.progressFill) this.progressFill.style.width = `${pct}%`;
		this.progressText?.setText(`${pct}%`);
		this.progressSize?.setText(`${formatBytes(this.transferredBytes)} / ${formatBytes(this.totalBytes)}`);
	}

	private updateProgressStats(): void {
		const values: Record<string, number> = { processed: this.completedOps, uploaded: this.uploaded, downloaded: this.downloaded, conflicts: this.conflicts, errors: this.errors };
		for (const [key, element] of this.progressStats) element.setText(String(values[key] ?? 0));
	}

	private showCompletion(result: SyncResult & { message: string }, dryRun = false): void {
		this.removeCompletion();
		this.completionSection = this.syncScroll.createDiv("syncit-completion-card");
		this.completionSection.createEl("h2", { text: dryRun ? "Dry run complete" : result.errors.length ? "Sync completed with errors" : "Sync complete" });
		this.completionSection.createEl("p", { text: result.message });
		const stats = this.completionSection.createDiv("syncit-completion-stats");
		for (const [label, value] of [["Uploaded", result.uploaded], ["Downloaded", result.downloaded], ["Deleted", result.deleted], ["Conflicts", result.conflicts], ["Errors", result.errors.length]]) {
			const item = stats.createDiv();
			item.createEl("strong", { text: String(value) });
			item.createEl("small", { text: String(label) });
		}
		if (result.errors.length > 0) {
			const errorsButton = this.completionSection.createEl("button", { text: `View ${result.errors.length} errors` });
			errorsButton.addEventListener("click", () => this.showTab("errors"));
		}
	}

	private removeProgress(): void {
		this.progressSection?.remove();
		this.progressSection = null;
		this.progressFill = null;
		this.progressText = null;
		this.progressSize = null;
		this.progressList = null;
		this.progressCancel = null;
		this.progressStats.clear();
		if (this.syncScroll) this.syncScroll.style.overflowY = "auto";
	}

	private removeCompletion(): void {
		this.completionSection?.remove();
		this.completionSection = null;
	}

	private removeReconciliation(): void {
		this.reconciliationSection?.remove();
		this.reconciliationSection = null;
		if (this.syncScroll) this.syncScroll.style.display = "flex";
	}
}

function formatBytes(bytes: number): string {
	if (!bytes) return "0 B";
	const units = ["B", "KB", "MB", "GB"];
	const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
	return `${parseFloat((bytes / Math.pow(1024, index)).toFixed(1))} ${units[index]}`;
}

function formatDuration(ms: number): string {
	if (ms < 1000) return `${ms}ms`;
	const seconds = Math.floor(ms / 1000);
	const minutes = Math.floor(seconds / 60);
	return minutes ? `${minutes}m ${(seconds % 60).toString().padStart(2, "0")}s` : `${seconds}s`;
}

function reconciliationReasonLabel(reason: SyncPlan["reconciliation"][number]["reason"]): string {
	return {
		"no-baseline-local-only": "Only on this device; no baseline",
		"no-baseline-remote-only": "Only on remote; no baseline",
		"no-baseline-conflict": "Changed on both sides",
		"possible-remote-deletion": "Possible remote deletion",
		"possible-local-deletion": "Possible local deletion",
	}[reason];
}

function fileSummary(item: SyncPlan["reconciliation"][number]): string {
	const local = item.local ? `local ${formatBytes(item.local.size)}` : "no local file";
	const remote = item.remote ? `remote ${formatBytes(item.remote.size)}` : "no remote file";
	return `${local}, ${remote}`;
}
