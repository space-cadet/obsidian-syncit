import { Modal, App } from "obsidian";
import type { SyncResult, SyncPlan, FileEntity } from "../types";

interface LogEntry {
	time: number;
	icon: string;
	text: string;
	size?: number;
	done?: boolean;
	error?: boolean;
}

type LogType = "upload" | "download" | "conflict" | "skip" | "error" | "system" | "delete" | "unchanged";

/**
 * Enhanced sync progress modal showing plan summary, transfer stats,
 * per-file sizes, and transfer rate.
 */
export class SyncProgressModal extends Modal {
	onCancel?: () => void;

	private startTime: number;
	private plan?: SyncPlan;
	private totalOps = 0;
	private completedCount = 0;
	private bytesTransferred = 0;
	private bytesTotal = 0;
	private logEntries: LogEntry[] = [];

	// DOM refs
	private headerEl!: HTMLElement;
	private progressBarEl!: HTMLElement;
	private progressFillEl!: HTMLElement;
	private progressTextEl!: HTMLElement;
	private planSummaryEl!: HTMLElement;
	private logEl!: HTMLElement;
	private statsEl!: HTMLElement;
	private btnRow!: HTMLElement;
	private cancelBtn!: HTMLElement;
	private backgroundBtn!: HTMLElement;
	private doneBtn!: HTMLElement;
	private isDone = false;

	constructor(app: App, options?: { onCancel?: () => void }) {
		super(app);
		this.startTime = Date.now();
		this.onCancel = options?.onCancel;
	}

	/** Set the sync plan so the modal can show pre-sync summary and sizes. */
	setPlan(plan: SyncPlan) {
		this.plan = plan;
		this.totalOps = plan.uploads.length + plan.downloads.length + plan.conflicts.length;

		// Compute total bytes to transfer
		const allOps = [...plan.uploads, ...plan.downloads, ...plan.conflicts.map(c => c.local.mtime >= c.remote.mtime ? c.local : c.remote)];
		this.bytesTotal = allOps.reduce((sum, f) => sum + (f.size || 0), 0);

		this.renderPlanSummary();
		this.progressTextEl.setText(`0/${this.totalOps} (0%)`);
	}

	/** Fallback if plan not available */
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

		// Plan summary (uploads / downloads / unchanged)
		this.planSummaryEl = contentEl.createDiv("syncit-plan-summary");
		this.planSummaryEl.style.fontSize = "0.85em";
		this.planSummaryEl.style.color = "var(--text-muted)";
		this.planSummaryEl.style.marginBottom = "0.75em";
		this.planSummaryEl.setText("Analyzing vault...");

		// Progress bar
		const progressContainer = contentEl.createDiv("syncit-progress-bar");
		progressContainer.style.height = "6px";
		progressContainer.style.background = "var(--background-modifier-border)";
		progressContainer.style.borderRadius = "3px";
		progressContainer.style.marginBottom = "0.75em";
		progressContainer.style.overflow = "hidden";

		this.progressFillEl = progressContainer.createDiv("syncit-progress-fill");
		this.progressFillEl.style.height = "100%";
		this.progressFillEl.style.width = "0%";
		this.progressFillEl.style.background = "var(--interactive-accent)";
		this.progressFillEl.style.transition = "width 0.2s ease";
		this.progressFillEl.style.borderRadius = "3px";

		// Stats line (size + rate)
		this.statsEl = contentEl.createDiv("syncit-stats");
		this.statsEl.style.fontSize = "0.8em";
		this.statsEl.style.color = "var(--text-faint)";
		this.statsEl.style.marginBottom = "0.75em";
		this.statsEl.setText("");

		// Log container
		this.logEl = contentEl.createDiv("syncit-log");
		this.logEl.style.maxHeight = "280px";
		this.logEl.style.overflowY = "auto";
		this.logEl.style.fontFamily = "var(--font-monospace)";
		this.logEl.style.fontSize = "0.85em";
		this.logEl.style.lineHeight = "1.6";
		this.logEl.style.background = "var(--background-primary-alt)";
		this.logEl.style.padding = "8px 10px";
		this.logEl.style.borderRadius = "4px";
		this.logEl.style.border = "1px solid var(--background-modifier-border)";

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

	/** Render the plan summary showing counts and sizes. */
	private renderPlanSummary() {
		if (!this.plan) return;

		const up = this.plan.uploads.length;
		const down = this.plan.downloads.length;
		const conflict = this.plan.conflicts.length;
		const unchanged = this.plan.unchanged;
		const totalSize = formatBytes(this.bytesTotal);

		const parts: string[] = [];
		if (up > 0) parts.push(`↑ ${up} upload${up > 1 ? "s" : ""}`);
		if (down > 0) parts.push(`↓ ${down} download${down > 1 ? "s" : ""}`);
		if (conflict > 0) parts.push(`⚡ ${conflict} conflict${conflict > 1 ? "s" : ""}`);
		if (unchanged > 0) parts.push(`✓ ${unchanged} unchanged`);

		this.planSummaryEl.setText(
			parts.join("  ·  ") + (this.bytesTotal > 0 ? `  ·  ${totalSize} total` : "")
		);
	}

	/** Add a log entry. Auto-updates progress if it's a file operation. */
	addLog(
		type: LogType,
		message: string,
		meta?: { done?: boolean; error?: boolean; size?: number },
	) {
		const icons: Record<string, string> = {
			upload: "↑",
			download: "↓",
			conflict: "⚡",
			skip: "⊘",
			delete: "🗑",
			error: "✗",
			system: "•",
			unchanged: "✓",
		};

		const entry: LogEntry = {
			time: Date.now(),
			icon: icons[type] || "•",
			text: message,
			size: meta?.size,
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
		text.style.overflow = "hidden";
		text.style.textOverflow = "ellipsis";
		text.setText(message);

		if (meta?.size && meta.size > 0) {
			const sizeEl = line.createEl("span");
			sizeEl.style.color = "var(--text-faint)";
			sizeEl.style.fontSize = "0.9em";
			sizeEl.setText(formatBytes(meta.size));
		}

		if (meta?.done) {
			const done = line.createEl("span");
			done.setText("✓");
			done.style.color = "var(--text-success)";
		}

		// Auto-scroll
		this.logEl.scrollTop = this.logEl.scrollHeight;

		// Update progress for completed operations
		if (meta?.done && type !== "system" && type !== "unchanged") {
			this.completedCount++;
			if (meta.size) this.bytesTransferred += meta.size;
			this.updateProgress();
		}
	}

	updateProgress() {
		const pct = this.totalOps > 0
			? Math.round((this.completedCount / this.totalOps) * 100)
			: 0;
		this.progressTextEl.setText(`${this.completedCount}/${this.totalOps} (${pct}%)`);
		this.progressFillEl.style.width = `${pct}%`;
		this.updateStats();
	}

	updateStats() {
		const elapsed = (Date.now() - this.startTime) / 1000;
		const rate = elapsed > 0 ? this.bytesTransferred / elapsed : 0;
		const remaining = this.bytesTotal - this.bytesTransferred;

		const parts: string[] = [];
		parts.push(`⏱️ ${elapsed.toFixed(1)}s`);
		if (this.bytesTransferred > 0) {
			parts.push(`📦 ${formatBytes(this.bytesTransferred)} / ${formatBytes(this.bytesTotal)}`);
			parts.push(`⚡ ${formatBytes(rate)}/s`);
		}
		if (remaining > 0 && rate > 0) {
			const eta = remaining / rate;
			parts.push(`⏳ ~${eta.toFixed(0)}s left`);
		}

		this.statsEl.setText(parts.join("  ·  "));
	}

	finish(result: SyncResult & { message: string }) {
		this.isDone = true;
		const elapsed = (Date.now() - this.startTime) / 1000;

		this.headerEl.empty();
		const title = this.headerEl.createEl("span");
		title.style.fontWeight = "600";
		const ok = result.errors.length === 0;
		title.setText(ok ? "✅ Sync complete" : "⚠️ Sync finished with errors");
		if (!ok) title.style.color = "var(--text-error)";

		this.progressTextEl.setText(result.message);
		this.progressFillEl.style.width = "100%";

		this.addLog("system", `Done in ${elapsed.toFixed(1)}s — ${result.message}`);

		if (result.errors.length > 0) {
			this.addLog("error", `${result.errors.length} error(s):`);
			for (const err of result.errors.slice(0, 5)) {
				this.addLog("error", `  ${err}`);
			}
			if (result.errors.length > 5) {
				this.addLog("system", `  ... and ${result.errors.length - 5} more`);
			}
		}

		// Final stats
		const rate = elapsed > 0 ? this.bytesTransferred / elapsed : 0;
		this.statsEl.setText(
			`⏱️ ${elapsed.toFixed(1)}s  ·  ↑${result.uploaded} ↓${result.downloaded} ⚡${result.conflicts} 🗑${result.deleted} ✓${result.skipped}  ·  📦 ${formatBytes(this.bytesTransferred)} at ${formatBytes(rate)}/s`
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

/** Format bytes to human-readable string. */
function formatBytes(bytes: number): string {
	if (bytes === 0) return "0 B";
	const k = 1024;
	const sizes = ["B", "KB", "MB", "GB"];
	const i = Math.floor(Math.log(bytes) / Math.log(k));
	return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}
