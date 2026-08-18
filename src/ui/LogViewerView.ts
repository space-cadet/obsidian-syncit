import { ItemView, WorkspaceLeaf, Notice } from "obsidian";
import type SyncItPlugin from "../main";
import type { LogEntry, LogLevel } from "../logging/SyncLogger";

export const LOG_VIEWER_VIEW_TYPE = "syncit-log-viewer";

type LogFilter = "ALL" | LogLevel;

export class LogViewerView extends ItemView {
	private plugin: SyncItPlugin;
	private filter: LogFilter = "ALL";
	private searchQuery = "";
	private entries: LogEntry[] = [];
	private refreshInterval: number | null = null;
	private logListEl: HTMLElement | null = null;
	private filterBtns: Map<LogFilter, HTMLElement> = new Map();
	private searchInput: HTMLInputElement | null = null;
	private clearBtn: HTMLElement | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: SyncItPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string { return LOG_VIEWER_VIEW_TYPE; }
	getDisplayText(): string { return "Sync Log"; }
	getIcon(): string { return "clock"; }

	async onOpen() {
		const container = this.containerEl.children[1] as HTMLElement;
		container.empty();
		container.addClass("syncit-log-viewer");
		container.style.display = "flex";
		container.style.flexDirection = "column";
		container.style.height = "100%";
		container.style.overflow = "hidden";

		// Header
		const header = container.createDiv("syncit-log-header");
		header.style.padding = "12px 16px";
		header.style.borderBottom = "1px solid var(--background-modifier-border)";
		header.style.display = "flex";
		header.style.alignItems = "center";
		header.style.gap = "8px";

		const icon = header.createEl("span");
		icon.setText("📋");
		icon.style.fontSize = "1.2em";

		const title = header.createEl("h3");
		title.setText("Sync Log");
		title.style.margin = "0";
		title.style.fontSize = "1.1em";
		title.style.fontWeight = "600";
		title.style.flex = "1";

		// Filter bar
		const filterBar = container.createDiv("syncit-log-filters");
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
			btn.addEventListener("click", () => this.setFilter(f.value));
			this.filterBtns.set(f.value, btn);
		}

		// Search row
		const searchRow = container.createDiv("syncit-log-search");
		searchRow.style.padding = "8px 16px";
		searchRow.style.borderBottom = "1px solid var(--background-modifier-border)";
		searchRow.style.display = "flex";
		searchRow.style.gap = "8px";

		this.searchInput = searchRow.createEl("input");
		this.searchInput.type = "text";
		this.searchInput.placeholder = "Search logs...";
		this.searchInput.style.flex = "1";
		this.searchInput.addClass("syncit-log-search-input");
		this.searchInput.addEventListener("input", () => {
			this.searchQuery = this.searchInput!.value;
			void this.renderEntries();
		});

		this.clearBtn = searchRow.createEl("button");
		this.clearBtn.setText("Clear");
		this.clearBtn.addClass("mod-warning");
		this.clearBtn.style.fontSize = "0.8em";
		this.clearBtn.addEventListener("click", () => {
			if (confirm("Clear all sync logs? This cannot be undone.")) {
				void this.plugin.logger?.clear().then(() => {
					this.entries = [];
					void this.renderEntries();
					new Notice("Sync log cleared");
				});
			}
		});

		// Log list container
		this.logListEl = container.createDiv("syncit-log-list");
		this.logListEl.style.flex = "1";
		this.logListEl.style.overflowY = "auto";
		this.logListEl.style.padding = "8px 16px";

		// Auto-refresh every 3 seconds when visible
		this.refreshInterval = window.setInterval(() => {
			void this.loadEntries();
		}, 3000);

		await this.loadEntries();
		this.updateFilterButtons();
	}

	async onClose(): Promise<void> {
		if (this.refreshInterval !== null) {
			window.clearInterval(this.refreshInterval);
			this.refreshInterval = null;
		}
	}

	private setFilter(filter: LogFilter) {
		this.filter = filter;
		this.updateFilterButtons();
		void this.renderEntries();
	}

	private updateFilterButtons() {
		for (const [value, btn] of this.filterBtns) {
			const isActive = value === this.filter;
			btn.style.background = isActive ? "var(--interactive-accent)" : "var(--background-primary)";
			btn.style.color = isActive ? "var(--text-on-accent)" : "var(--text-normal)";
			btn.style.borderColor = isActive ? "var(--interactive-accent)" : "var(--background-modifier-border)";
			btn.style.fontWeight = isActive ? "600" : "400";
		}
	}

	private async loadEntries() {
		if (!this.plugin.logger) return;
		this.entries = await this.plugin.logger.readEntries({
			level: this.filter === "ALL" ? undefined : this.filter,
			search: this.searchQuery || undefined,
			limit: 500,
		});
		await this.renderEntries();
	}

	private async renderEntries() {
		if (!this.logListEl) return;
		this.logListEl.empty();

		if (this.entries.length === 0) {
			const empty = this.logListEl.createEl("div");
			empty.style.textAlign = "center";
			empty.style.padding = "40px 20px";
			empty.style.color = "var(--text-muted)";
			empty.setText("No log entries");
			return;
		}

		// Group by session (5-minute gaps)
		const groups = this.groupBySession(this.entries);

		for (const group of groups) {
			const sessionEl = this.logListEl.createDiv("syncit-log-session");
			sessionEl.style.marginBottom = "12px";
			sessionEl.style.border = "1px solid var(--background-modifier-border)";
			sessionEl.style.borderRadius = "6px";
			sessionEl.style.overflow = "hidden";

			// Session header
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

			// Level summary
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

			// Entries container
			const entriesContainer = sessionEl.createDiv("syncit-log-session-entries");
			entriesContainer.style.padding = "4px 0";

			for (const entry of group.entries) {
				this.renderEntry(entriesContainer, entry);
			}

			// Toggle collapse
			let expanded = true;
			sessionHeader.addEventListener("click", () => {
				expanded = !expanded;
				entriesContainer.style.display = expanded ? "block" : "none";
				expandIcon.style.transform = expanded ? "rotate(0deg)" : "rotate(-90deg)";
			});
		}
	}

	private renderEntry(container: HTMLElement, entry: LogEntry) {
		const row = container.createDiv("syncit-log-entry");
		row.style.padding = "6px 12px";
		row.style.borderBottom = "1px solid var(--background-modifier-border-hover)";
		row.style.display = "flex";
		row.style.alignItems = "flex-start";
		row.style.gap = "8px";

		// Level badge
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

		// Content
		const content = row.createDiv();
		content.style.flex = "1";
		content.style.minWidth = "0";

		// Time + category
		const meta = content.createEl("div");
		meta.style.fontSize = "0.75em";
		meta.style.color = "var(--text-muted)";
		meta.style.marginBottom = "2px";
		const timeStr = new Date(entry.timestamp).toLocaleTimeString();
		meta.setText(`${timeStr} · ${entry.category}`);

		// Message
		const message = content.createEl("div");
		message.style.fontSize = "0.85em";
		message.style.wordBreak = "break-word";
		message.setText(entry.message);

		// Details (if present)
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
				if (current.length > 0) {
					groups.push({ startTime: current[0].timestamp, entries: current });
				}
				current = [];
			}
			current.push(entry);
			lastTime = entryTime;
		}

		if (current.length > 0) {
			groups.push({ startTime: current[0].timestamp, entries: current });
		}

		return groups;
	}

	private countLevels(entries: LogEntry[]): Record<LogLevel, number> {
		const counts: Record<string, number> = { ERROR: 0, WARNING: 0, INFO: 0, DEBUG: 0 };
		for (const e of entries) {
			counts[e.level] = (counts[e.level] ?? 0) + 1;
		}
		return counts as Record<LogLevel, number>;
	}

	private getLevelColors(level: LogLevel): { bg: string; fg: string } {
		switch (level) {
			case "ERROR":
				return { bg: "rgba(var(--color-red-rgb), 0.15)", fg: "var(--color-red)" };
			case "WARNING":
				return { bg: "rgba(var(--color-orange-rgb), 0.15)", fg: "var(--color-orange)" };
			case "INFO":
				return { bg: "rgba(var(--color-blue-rgb), 0.12)", fg: "var(--color-blue)" };
			case "DEBUG":
				return { bg: "var(--background-modifier-border)", fg: "var(--text-muted)" };
		}
	}
}
