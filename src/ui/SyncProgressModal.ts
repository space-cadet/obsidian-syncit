import { Modal, App } from "obsidian";
import type { SyncResult } from "../types";

interface LogEntry {
	time: number;
	icon: string;
	text: string;
	done?: boolean;
	error?: boolean;
}

type LogType = "upload" | "download" | "conflict" | "skip" | "error" | "system" | "delete";

export class SyncProgressModal extends Modal {
	// Public so main.ts can set cancel handler
	onCancel?: () => void;
	private startTime: number;
	private totalOps = 0;
	private completedCount = 0;
	private logEntries: LogEntry[] = [];

	// DOM refs
	private headerEl!: HTMLElement;
	private progressBarEl!: HTMLElement;
	private progressFillEl!: HTMLElement;
	private progressTextEl!: HTMLElement;
	private logEl!: HTMLElement;
	private summaryEl!: HTMLElement;
	private btnRow!: HTMLElement;
	private cancelBtn!: HTMLElement;
	private backgroundBtn!: HTMLElement;
	private doneBtn!: HTMLElement;
	private isDone = false;

	constructor(app: App, totalOps: number, options?: { onCancel?: () => void }) {
		super(app);
		this.startTime = Date.now();
		this.totalOps = totalOps;
		this.onCancel = options?.onCancel;
	}

	/** Update total operation count after plan is computed */
	setTotal(total: number) {
		this.totalOps = total;
		this.progressTextEl.setText(`0/${this.totalOps} (0%)`);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("syncit-progress-modal");

		// Header with progress
		this.headerEl = contentEl.createDiv("syncit-header");
		this.headerEl.style.display = "flex";
		this.headerEl.style.justifyContent = "space-between";
		this.headerEl.style.alignItems = "center";
		this.headerEl.style.marginBottom = "0.5em";

		const title = this.headerEl.createEl("span");
		title.style.fontWeight = "600";
		title.setText(`🔄 Syncing vault`);

		this.progressTextEl = this.headerEl.createEl("span");
		this.progressTextEl.style.color = "var(--text-muted)";
		this.progressTextEl.setText(`0/${this.totalOps}`);

		// Progress bar
		const progressContainer = contentEl.createDiv("syncit-progress-bar");
		progressContainer.style.height = "6px";
		progressContainer.style.background = "var(--background-modifier-border)";
		progressContainer.style.borderRadius = "3px";
		progressContainer.style.marginBottom = "1em";
		progressContainer.style.overflow = "hidden";

		this.progressFillEl = progressContainer.createDiv("syncit-progress-fill");
		this.progressFillEl.style.height = "100%";
		this.progressFillEl.style.width = "0%";
		this.progressFillEl.style.background = "var(--interactive-accent)";
		this.progressFillEl.style.transition = "width 0.2s ease";
		this.progressFillEl.style.borderRadius = "3px";

		// Log container (terminal style)
		this.logEl = contentEl.createDiv("syncit-log");
		this.logEl.style.maxHeight = "300px";
		this.logEl.style.overflowY = "auto";
		this.logEl.style.fontFamily = "var(--font-monospace)";
		this.logEl.style.fontSize = "0.85em";
		this.logEl.style.lineHeight = "1.6";
		this.logEl.style.background = "var(--background-primary-alt)";
		this.logEl.style.padding = "8px 10px";
		this.logEl.style.borderRadius = "4px";
		this.logEl.style.border = "1px solid var(--background-modifier-border)";

		// Summary line
		this.summaryEl = contentEl.createDiv("syncit-summary");
		this.summaryEl.style.marginTop = "0.75em";
		this.summaryEl.style.color = "var(--text-muted)";
		this.summaryEl.style.fontSize = "0.85em";
		this.summaryEl.setText("⏱️ Starting...");

		// Buttons
		this.btnRow = contentEl.createDiv("syncit-btn-row");
		this.btnRow.style.marginTop = "1em";
		this.btnRow.style.display = "flex";
		this.btnRow.style.gap = "0.5em";
		this.btnRow.style.justifyContent = "flex-end";

		this.cancelBtn = this.btnRow.createEl("button", { text: "Cancel" });
		this.cancelBtn.addEventListener("click", () => {
			this.onCancel?.();
			this.cancelBtn.setText("Cancelling...");
			(this.cancelBtn as HTMLButtonElement).disabled = true;
		});

		this.backgroundBtn = this.btnRow.createEl("button", { text: "Background" });
		this.backgroundBtn.addEventListener("click", () => {
			this.close();
		});

		this.doneBtn = this.btnRow.createEl("button", { text: "Done" });
		this.doneBtn.style.display = "none";
		this.doneBtn.addEventListener("click", () => {
			this.close();
		});

		this.addLog("system", "Starting vault sync...");
	}

	/** Add a log entry. Auto-updates progress if it's a file operation. */
	addLog(
		type: LogType,
		message: string,
		meta?: { done?: boolean; error?: boolean },
	) {
		const icons: Record<string, string> = {
			upload: "↑",
			download: "↓",
			conflict: "⚡",
			skip: "⊘",
			delete: "🗑",
			error: "✗",
			system: "•",
		};

		const entry: LogEntry = {
			time: Date.now(),
			icon: icons[type] || "•",
			text: message,
			done: meta?.done,
			error: meta?.error,
		};
		this.logEntries.push(entry);

		// Render the entry
		const line = this.logEl.createDiv("syncit-log-line");
		line.style.display = "flex";
		line.style.gap = "6px";
		line.style.opacity = meta?.done ? "0.6" : "1";
		if (meta?.error) line.style.color = "var(--text-error)";

		const icon = line.createEl("span");
		icon.style.minWidth = "1em";
		icon.setText(entry.icon);

		const text = line.createEl("span");
		text.style.flex = "1";
		text.setText(message);

		if (meta?.done) {
			const done = line.createEl("span");
			done.setText("✓");
			done.style.color = "var(--text-success)";
		}

		// Auto-scroll
		this.logEl.scrollTop = this.logEl.scrollHeight;

		// Update progress for completed operations
		if (meta?.done) {
			this.completedCount++;
			this.updateProgress();
		}
	}

	updateProgress() {
		const pct = this.totalOps > 0
			? Math.round((this.completedCount / this.totalOps) * 100)
			: 0;
		this.progressTextEl.setText(`${this.completedCount}/${this.totalOps} (${pct}%)`);
		this.progressFillEl.style.width = `${pct}%`;
		this.updateSummary();
	}

	updateSummary() {
		const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1);
		this.summaryEl.setText(`⏱️ ${elapsed}s elapsed  ·  ${this.completedCount} done`);
	}

	finish(result: SyncResult & { message: string }) {
		this.isDone = true;
		const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1);

		this.headerEl.empty();
		const title = this.headerEl.createEl("span");
		title.style.fontWeight = "600";
		const ok = result.errors.length === 0;
		title.setText(ok ? "✅ Sync complete" : "⚠️ Sync finished with errors");
		if (!ok) title.style.color = "var(--text-error)";

		this.progressTextEl.setText(result.message);
		this.progressFillEl.style.width = "100%";

		this.addLog("system", `Done in ${elapsed}s — ${result.message}`);

		if (result.errors.length > 0) {
			this.addLog("error", `${result.errors.length} error(s):`);
			for (const err of result.errors.slice(0, 5)) {
				this.addLog("error", `  ${err}`);
			}
			if (result.errors.length > 5) {
				this.addLog("system", `  ... and ${result.errors.length - 5} more`);
			}
		}

		this.summaryEl.setText(
			`⏱️ ${elapsed}s  ·  ↑${result.uploaded} ↓${result.downloaded} ⚡${result.conflicts} 🗑${result.deleted} ⊘${result.skipped}`
		);

		// Swap buttons
		this.cancelBtn.style.display = "none";
		this.backgroundBtn.style.display = "none";
		this.doneBtn.style.display = "inline-block";
	}

	onClose() {
		this.contentEl.empty();
	}
}
