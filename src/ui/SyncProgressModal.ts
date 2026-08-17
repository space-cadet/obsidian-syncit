import { Modal, App } from "obsidian";
import type { SyncResult, SyncPlan, FileEntity } from "../types";

/**
 * Compact sync progress modal.
 * Shows live-updating stat cards + files appended as processed.
 */
export class SyncProgressModal extends Modal {
	onCancel?: () => void;

	private startTime: number;
	private isDone = false;

	// Mutable counters for live stats
	private scanned = 0;
	private uploaded = 0;
	private skipped = 0;
	private overwritten = 0;
	private conflicts = 0;
	private totalOps = 0;
	private completedOps = 0;

	// DOM refs
	private syncTitleEl!: HTMLElement;
	private subtitleEl!: HTMLElement;
	private progressFillEl!: HTMLElement;
	private progressPercentEl!: HTMLElement;
	private statCards!: Map<string, { valueEl: HTMLElement; label: string }>;
	private fileListEl!: HTMLElement;
	private btnRow!: HTMLElement;
	private cancelBtn!: HTMLElement;
	private doneBtn!: HTMLElement;

	constructor(app: App, options?: { onCancel?: () => void }) {
		super(app);
		this.startTime = Date.now();
		this.onCancel = options?.onCancel;
		this.statCards = new Map();
	}

	setPlan(plan: SyncPlan) {
		this.scanned = plan.uploads.length + plan.downloads.length + plan.conflicts.length + plan.unchanged;
		this.uploaded = 0;
		this.skipped = plan.unchanged;
		this.overwritten = 0;
		this.conflicts = 0;
		this.totalOps = plan.uploads.length + plan.downloads.length + plan.conflicts.length;
		this.completedOps = 0;
		this.updateStats();
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("syncit-progress-modal");
		contentEl.style.padding = "12px";
		contentEl.style.maxWidth = "360px";

		// Title
		const titleSection = contentEl.createDiv();
		titleSection.style.textAlign = "center";
		titleSection.style.marginBottom = "8px";

		this.syncTitleEl = titleSection.createEl("h3", { text: "🔄 Syncing files" });
		this.syncTitleEl.style.margin = "0 0 2px 0";
		this.syncTitleEl.style.fontSize = "1.1em";

		this.subtitleEl = titleSection.createEl("p");
		this.subtitleEl.style.margin = "0";
		this.subtitleEl.style.color = "var(--text-muted)";
		this.subtitleEl.style.fontSize = "0.8em";
		this.subtitleEl.setText("Analyzing...");

		// Progress bar
		const progressContainer = contentEl.createDiv();
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

		this.progressPercentEl = contentEl.createEl("div");
		this.progressPercentEl.style.textAlign = "right";
		this.progressPercentEl.style.fontSize = "0.75em";
		this.progressPercentEl.style.color = "var(--text-muted)";
		this.progressPercentEl.style.marginBottom = "8px";
		this.progressPercentEl.setText("0%");

		// Stats row (horizontal, compact)
		const statsRow = contentEl.createDiv();
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

			this.statCards.set(def.key, { valueEl, label: def.label });
		}

		// Files header
		const filesHeader = contentEl.createEl("div");
		filesHeader.style.fontSize = "0.75em";
		filesHeader.style.color = "var(--text-faint)";
		filesHeader.style.marginBottom = "4px";
		filesHeader.setText("Files");

		// File list
		this.fileListEl = contentEl.createDiv();
		this.fileListEl.style.maxHeight = "200px";
		this.fileListEl.style.overflowY = "auto";
		this.fileListEl.style.display = "flex";
		this.fileListEl.style.flexDirection = "column";
		this.fileListEl.style.gap = "3px";

		// Buttons
		this.btnRow = contentEl.createDiv();
		this.btnRow.style.marginTop = "10px";
		this.btnRow.style.display = "flex";
		this.btnRow.style.gap = "8px";
		this.btnRow.style.justifyContent = "center";

		this.cancelBtn = this.btnRow.createEl("button", { text: "Cancel", cls: "mod-warning" });
		this.cancelBtn.style.flex = "1";
		this.cancelBtn.style.fontSize = "0.9em";
		this.cancelBtn.addEventListener("click", () => {
			this.onCancel?.();
			this.cancelBtn.setText("Cancelling...");
			(this.cancelBtn as HTMLButtonElement).disabled = true;
		});

		this.doneBtn = this.btnRow.createEl("button", { text: "Done", cls: "mod-cta" });
		this.doneBtn.style.flex = "1";
		this.doneBtn.style.fontSize = "0.9em";
		this.doneBtn.style.display = "none";
		this.doneBtn.addEventListener("click", () => {
			this.close();
		});
	}

	/** Update all stat cards from current counters. */
	private updateStats() {
		const values: Record<string, number> = {
			scanned: this.scanned,
			upload: this.uploaded,
			skip: this.skipped,
			overwrite: this.overwritten,
			conflict: this.conflicts,
		};
		for (const [key, { valueEl }] of this.statCards) {
			valueEl.setText(String(values[key] ?? 0));
		}
	}

	/** Call when a file operation completes. */
	markFileDone(path: string, operation: "upload" | "download" | "conflict" | "error", meta?: { size?: number }) {
		this.completedOps++;

		// Update counters
		if (operation === "upload") this.uploaded++;
		else if (operation === "download") this.overwritten++;
		else if (operation === "conflict") this.conflicts++;

		this.updateStats();
		this.updateProgress();

		// Subtitle
		const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1);
		this.subtitleEl.setText(`${this.completedOps} of ${this.totalOps} files · ${elapsed}s`);

		// Append file row
		const row = this.fileListEl.createDiv();
		row.style.display = "flex";
		row.style.alignItems = "center";
		row.style.gap = "6px";
		row.style.padding = "4px 6px";
		row.style.background = "var(--background-primary-alt)";
		row.style.borderRadius = "4px";
		row.style.fontSize = "0.85em";

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

		// Scroll to show latest
		this.fileListEl.scrollTop = this.fileListEl.scrollHeight;
	}

	updateProgress() {
		const pct = this.totalOps > 0 ? Math.round((this.completedOps / this.totalOps) * 100) : 0;
		this.progressFillEl.style.width = `${pct}%`;
		this.progressPercentEl.setText(`${pct}%`);
	}

	finish(result: SyncResult & { message: string }) {
		this.isDone = true;
		const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1);

		this.syncTitleEl.setText("✅ Sync complete");
		this.subtitleEl.setText(`${result.message} · ${elapsed}s`);

		this.progressFillEl.style.width = "100%";
		this.progressPercentEl.setText("100%");

		// Final stats update
		this.uploaded = result.uploaded;
		this.overwritten = result.downloaded;
		this.conflicts = result.conflicts;
		this.skipped = result.skipped;
		this.updateStats();

		// Swap buttons
		this.cancelBtn.style.display = "none";
		this.doneBtn.style.display = "block";
	}

	onClose() {
		this.contentEl.empty();
	}
}

function formatBytes(bytes: number): string {
	if (bytes === 0) return "0 B";
	const k = 1024;
	const sizes = ["B", "KB", "MB", "GB"];
	const i = Math.floor(Math.log(bytes) / Math.log(k));
	return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}
