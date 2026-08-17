import { Modal, App } from "obsidian";
import type { SyncResult, SyncPlan, FileEntity } from "../types";

interface FileAction {
	path: string;
	type: "upload" | "download" | "skip" | "conflict" | "error";
	subtitle: string;
	badge: string;
	size?: number;
}

/**
 * Redesigned sync progress modal matching the screenshot design.
 * Shows summary stat cards + per-file list with status badges.
 */
export class SyncProgressModal extends Modal {
	onCancel?: () => void;

	private startTime: number;
	private plan?: SyncPlan;
	private isDone = false;
	private fileActions: FileAction[] = [];

	// DOM refs
	private titleEl!: HTMLElement;
	private subtitleEl!: HTMLElement;
	private progressBarEl!: HTMLElement;
	private progressFillEl!: HTMLElement;
	private progressPercentEl!: HTMLElement;
	private statsGridEl!: HTMLElement;
	private fileListEl!: HTMLElement;
	private btnRow!: HTMLElement;
	private cancelBtn!: HTMLElement;
	private doneBtn!: HTMLElement;

	constructor(app: App, options?: { onCancel?: () => void }) {
		super(app);
		this.startTime = Date.now();
		this.onCancel = options?.onCancel;
	}

	setPlan(plan: SyncPlan) {
		this.plan = plan;
		this.renderStatsGrid();
		this.renderFileListPreview(plan);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("syncit-progress-modal");
		contentEl.style.padding = "20px";

		// Title section
		const titleSection = contentEl.createDiv("syncit-title-section");
		titleSection.style.textAlign = "center";
		titleSection.style.marginBottom = "16px";

		this.titleEl = titleSection.createEl("h2", { text: "🔄 Syncing files" });
		this.titleEl.style.margin = "0 0 4px 0";
		this.titleEl.style.fontSize = "1.3em";

		this.subtitleEl = titleSection.createEl("p");
		this.subtitleEl.style.margin = "0";
		this.subtitleEl.style.color = "var(--text-muted)";
		this.subtitleEl.style.fontSize = "0.9em";
		this.subtitleEl.setText("Analyzing vault...");

		// Progress bar
		const progressContainer = contentEl.createDiv("syncit-progress-bar");
		progressContainer.style.height = "8px";
		progressContainer.style.background = "var(--background-modifier-border)";
		progressContainer.style.borderRadius = "4px";
		progressContainer.style.marginBottom = "16px";
		progressContainer.style.overflow = "hidden";
		progressContainer.style.position = "relative";

		this.progressFillEl = progressContainer.createDiv("syncit-progress-fill");
		this.progressFillEl.style.height = "100%";
		this.progressFillEl.style.width = "0%";
		this.progressFillEl.style.background = "var(--interactive-accent)";
		this.progressFillEl.style.transition = "width 0.3s ease";
		this.progressFillEl.style.borderRadius = "4px";

		this.progressPercentEl = contentEl.createEl("div");
		this.progressPercentEl.style.textAlign = "right";
		this.progressPercentEl.style.fontSize = "0.85em";
		this.progressPercentEl.style.color = "var(--text-muted)";
		this.progressPercentEl.style.marginBottom = "12px";
		this.progressPercentEl.setText("0%");

		// Stats grid (2x2 or 3x2 cards)
		this.statsGridEl = contentEl.createDiv("syncit-stats-grid");
		this.statsGridEl.style.display = "grid";
		this.statsGridEl.style.gridTemplateColumns = "1fr 1fr";
		this.statsGridEl.style.gap = "8px";
		this.statsGridEl.style.marginBottom = "16px";

		// File list
		const listHeader = contentEl.createEl("div");
		listHeader.style.fontSize = "0.8em";
		listHeader.style.color = "var(--text-faint)";
		listHeader.style.marginBottom = "8px";
		listHeader.setText("Files");

		this.fileListEl = contentEl.createDiv("syncit-file-list");
		this.fileListEl.style.maxHeight = "300px";
		this.fileListEl.style.overflowY = "auto";
		this.fileListEl.style.display = "flex";
		this.fileListEl.style.flexDirection = "column";
		this.fileListEl.style.gap = "6px";

		// Buttons
		this.btnRow = contentEl.createDiv("syncit-btn-row");
		this.btnRow.style.marginTop = "16px";
		this.btnRow.style.display = "flex";
		this.btnRow.style.gap = "8px";
		this.btnRow.style.justifyContent = "center";

		this.cancelBtn = this.btnRow.createEl("button", { text: "Cancel", cls: "mod-warning" });
		this.cancelBtn.style.flex = "1";
		this.cancelBtn.addEventListener("click", () => {
			this.onCancel?.();
			this.cancelBtn.setText("Cancelling...");
			(this.cancelBtn as HTMLButtonElement).disabled = true;
		});

		this.doneBtn = this.btnRow.createEl("button", { text: "Done", cls: "mod-cta" });
		this.doneBtn.style.flex = "1";
		this.doneBtn.style.display = "none";
		this.doneBtn.addEventListener("click", () => {
			this.close();
		});
	}

	private renderStatsGrid() {
		if (!this.plan) return;

		this.statsGridEl.empty();

		const stats = [
			{ label: "scanned", value: this.plan.uploads.length + this.plan.downloads.length + this.plan.conflicts.length + this.plan.unchanged, color: "var(--text-normal)" },
			{ label: "upload", value: this.plan.uploads.length, color: "var(--text-success)" },
			{ label: "skip", value: this.plan.unchanged, color: "var(--text-muted)" },
			{ label: "overwrite", value: this.plan.downloads.length, color: "var(--text-accent)" },
			{ label: "conflict", value: this.plan.conflicts.length, color: "var(--text-warning)" },
		];

		for (const stat of stats) {
			const card = this.statsGridEl.createDiv("syncit-stat-card");
			card.style.background = "var(--background-primary-alt)";
			card.style.borderRadius = "8px";
			card.style.padding = "10px 12px";
			card.style.textAlign = "center";

			const value = card.createEl("div");
			value.style.fontSize = "1.4em";
			value.style.fontWeight = "700";
			value.style.color = stat.color;
			value.setText(String(stat.value));

			const label = card.createEl("div");
			label.style.fontSize = "0.75em";
			label.style.color = "var(--text-faint)";
			label.style.marginTop = "2px";
			label.setText(stat.label);
		}
	}

	private renderFileListPreview(plan: SyncPlan) {
		this.fileListEl.empty();

		// Show all files with their planned action
		const allFiles: Array<{ file: FileEntity; type: FileAction["type"]; subtitle: string; badge: string }> = [
			...plan.uploads.map(f => ({ file: f, type: "upload" as const, subtitle: "Not found", badge: "Uploading" })),
			...plan.downloads.map(f => ({ file: f, type: "download" as const, subtitle: "Server older", badge: "Overwriting" })),
			...plan.conflicts.map(c => ({ file: c.local, type: "conflict" as const, subtitle: "Changed", badge: "Conflict" })),
		];

		for (const item of allFiles) {
			this.addFileAction({
				path: item.file.path,
				type: item.type,
				subtitle: item.subtitle,
				badge: item.badge,
				size: item.file.size,
			});
		}
	}

	addFileAction(action: FileAction) {
		this.fileActions.push(action);

		const row = this.fileListEl.createDiv("syncit-file-row");
		row.style.display = "flex";
		row.style.alignItems = "center";
		row.style.gap = "10px";
		row.style.padding = "8px 10px";
		row.style.background = "var(--background-primary-alt)";
		row.style.borderRadius = "6px";

		// Icon
		const icon = row.createEl("span");
		icon.style.fontSize = "1.2em";
		icon.style.width = "24px";
		icon.style.textAlign = "center";
		const icons: Record<string, string> = {
			upload: "📄",
			download: "🔄",
			skip: "✓",
			conflict: "⚠️",
			error: "❌",
		};
		icon.setText(icons[action.type] || "•");

		// File info
		const info = row.createDiv();
		info.style.flex = "1";
		info.style.minWidth = "0";

		const path = info.createEl("div");
		path.style.fontSize = "0.9em";
		path.style.fontWeight = "500";
		path.style.overflow = "hidden";
		path.style.textOverflow = "ellipsis";
		path.style.whiteSpace = "nowrap";
		path.setText(action.path);

		const meta = info.createEl("div");
		meta.style.fontSize = "0.8em";
		meta.style.color = "var(--text-faint)";
		meta.style.marginTop = "2px";

		const sizeText = action.size ? ` · ${formatBytes(action.size)}` : "";
		meta.setText(`${action.subtitle}${sizeText}`);

		// Status badge
		const badge = row.createEl("span");
		badge.style.fontSize = "0.75em";
		badge.style.padding = "3px 8px";
		badge.style.borderRadius = "4px";
		badge.style.fontWeight = "600";
		badge.style.whiteSpace = "nowrap";

		const badgeStyles: Record<string, { bg: string; color: string }> = {
			"Uploading": { bg: "rgba(var(--color-green-rgb), 0.15)", color: "var(--color-green)" },
			"Overwriting": { bg: "rgba(var(--color-blue-rgb), 0.15)", color: "var(--color-blue)" },
			"Skipped": { bg: "rgba(var(--text-muted), 0.1)", color: "var(--text-muted)" },
			"Conflict": { bg: "rgba(var(--color-orange-rgb), 0.15)", color: "var(--color-orange)" },
			"Error": { bg: "rgba(var(--color-red-rgb), 0.15)", color: "var(--color-red)" },
		};
		const style = badgeStyles[action.badge] || badgeStyles["Skipped"];
		badge.style.background = style.bg;
		badge.style.color = style.color;
		badge.setText(action.badge);

		// Scroll to bottom
		this.fileListEl.scrollTop = this.fileListEl.scrollHeight;
	}

	updateProgress(current: number, total: number) {
		const pct = total > 0 ? Math.round((current / total) * 100) : 0;
		this.progressFillEl.style.width = `${pct}%`;
		this.progressPercentEl.setText(`${pct}%`);

		const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1);
		this.subtitleEl.setText(`${current} of ${total} files · ${elapsed}s`);
	}

	markFileDone(path: string, newBadge?: string) {
		// Find the row for this file and update its badge
		const rows = this.fileListEl.querySelectorAll(".syncit-file-row");
		for (const row of Array.from(rows)) {
			const pathEl = row.querySelector("div > div:first-child");
			if (pathEl?.textContent === path) {
				const badge = row.querySelector("span:last-child") as HTMLElement;
				if (badge && newBadge) {
					badge.setText(newBadge);
					const badgeStyles: Record<string, { bg: string; color: string }> = {
						"Uploaded": { bg: "rgba(var(--color-green-rgb), 0.15)", color: "var(--color-green)" },
						"Downloaded": { bg: "rgba(var(--color-blue-rgb), 0.15)", color: "var(--color-blue)" },
						"Skipped": { bg: "rgba(var(--text-muted), 0.1)", color: "var(--text-muted)" },
						"Conflict": { bg: "rgba(var(--color-orange-rgb), 0.15)", color: "var(--color-orange)" },
						"Error": { bg: "rgba(var(--color-red-rgb), 0.15)", color: "var(--color-red)" },
					};
					const style = badgeStyles[newBadge] || badgeStyles["Skipped"];
					badge.style.background = style.bg;
					badge.style.color = style.color;
				}
				break;
			}
		}
	}

	finish(result: SyncResult & { message: string }) {
		this.isDone = true;
		const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1);

		this.titleEl.setText("✅ Sync complete");
		this.subtitleEl.setText(`${result.message} · ${elapsed}s`);

		this.progressFillEl.style.width = "100%";
		this.progressPercentEl.setText("100%");

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
