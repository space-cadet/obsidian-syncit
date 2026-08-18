import { App, Notice, Modal, Setting, requestUrl } from "obsidian";

export interface ReleaseInfo {
	tag_name: string;
	name: string;
	body: string;
	prerelease: boolean;
	published_at: string;
	html_url: string;
	assets: Array<{
		name: string;
		browser_download_url: string;
		size: number;
	}>;
}

export interface AvailableBuild {
	release: ReleaseInfo;
	branch: string;
	commitHash?: string;
	/** Actual git commit timestamp (author date), not release published_at */
	committedAt?: string;
}

export interface CommitInfo {
	sha: string;
	message: string;
	authorName: string;
	committedAt: string;
}

export interface UpdateCheckResult {
	hasUpdate: boolean;
	currentVersion: string;
	latestVersion: string;
	release: ReleaseInfo | null;
	isPrerelease: boolean;
	commitMatch?: boolean;
	latestCommit?: CommitInfo | null;
}

const GITHUB_REPO = "space-cadet/obsidian-syncit";
const RELEASE_FILES = ["main.js", "manifest.json", "styles.css"];

/** Debug logger that writes to plugin data directory */
class DebugLogger {
	private app: App;
	private pluginId: string;
	private logPath: string;

	constructor(app: App, pluginId: string) {
		this.app = app;
		this.pluginId = pluginId;
		this.logPath = `.obsidian/plugins/${pluginId}/debug.log`;
	}

	async log(level: string, message: string, data?: any): Promise<void> {
		const timestamp = new Date().toISOString();
		const entry = `[${timestamp}] [${level}] ${message}` +
			(data ? `\n  Data: ${JSON.stringify(data, null, 2)}` : "");
		
		try {
			const existing = await this.app.vault.adapter.exists(this.logPath)
				? await this.app.vault.adapter.read(this.logPath)
				: "";
			// Keep last 1000 lines
			const lines = existing.split("\n").slice(-999);
			lines.push(entry);
			await this.app.vault.adapter.write(this.logPath, lines.join("\n"));
		} catch {
			// Silently fail - debug logging should never break functionality
		}
	}

	async info(message: string, data?: any): Promise<void> {
		await this.log("INFO", message, data);
	}

	async error(message: string, data?: any): Promise<void> {
		await this.log("ERROR", message, data);
	}

	async debug(message: string, data?: any): Promise<void> {
		await this.log("DEBUG", message, data);
	}
}

/** Simple semver comparison: returns >0 if v1 > v2, <0 if v1 < v2, 0 if equal.
 *  Non-semver tags (e.g. "latest-dev") are treated as always newer than semver versions. */
function compareVersions(v1: string, v2: string): number {
	const clean1 = v1.replace(/^v/, "");
	const clean2 = v2.replace(/^v/, "");

	const isSemver1 = /^\d+(\.\d+)*$/.test(clean1);
	const isSemver2 = /^\d+(\.\d+)*$/.test(clean2);

	if (!isSemver1 && isSemver2) return 1;
	if (isSemver1 && !isSemver2) return -1;
	if (!isSemver1 && !isSemver2) return clean1 === clean2 ? 0 : 1;

	const a = clean1.split(".").map(Number);
	const b = clean2.split(".").map(Number);
	for (let i = 0; i < Math.max(a.length, b.length); i++) {
		const av = a[i] || 0;
		const bv = b[i] || 0;
		if (av !== bv) return av - bv;
	}
	return 0;
}

async function fetchLatestCommit(branch: string = "main"): Promise<CommitInfo | null> {
	try {
		const data = await fetchJson(
			`https://api.github.com/repos/${GITHUB_REPO}/commits/${encodeURIComponent(branch)}`,
		);
		if (!data?.sha) return null;
		return {
			sha: data.sha,
			message: data.commit?.message?.split("\n")[0] ?? "",
			authorName: data.commit?.author?.name ?? data.author?.login ?? "",
			committedAt:
				data.commit?.author?.date ?? data.commit?.committer?.date ?? "",
		};
	} catch {
		return null;
	}
}

async function fetchJson(url: string): Promise<any> {
	const response = await requestUrl({
		url,
		method: "GET",
		headers: { "User-Agent": "obsidian-syncit-updater" },
	});
	return JSON.parse(response.text);
}

function branchFromRelease(release: ReleaseInfo): string {
	const prefix = "latest-dev-";
	return release.tag_name.startsWith(prefix)
		? release.tag_name.slice(prefix.length)
		: "main";
}

async function downloadFile(app: App, url: string, destPath: string): Promise<void> {
	const response = await requestUrl({
		url,
		method: "GET",
		headers: { "User-Agent": "obsidian-syncit-updater" },
	});
	await app.vault.adapter.write(destPath, response.text);
}

export class PluginUpdater {
	private app: App;
	private pluginDir: string;
	private logger: DebugLogger;

	constructor(app: App, pluginId: string) {
		this.app = app;
		this.pluginDir = `.obsidian/plugins/${pluginId}`;
		this.logger = new DebugLogger(app, pluginId);
	}

	private async ensureDir(dirPath: string): Promise<void> {
		try {
			await this.app.vault.adapter.mkdir(dirPath);
		} catch {
			// Directory may already exist
		}
	}

	private async fileExists(filePath: string): Promise<boolean> {
		return this.app.vault.adapter.exists(filePath);
	}

	private async readFile(filePath: string): Promise<string> {
		return this.app.vault.adapter.read(filePath);
	}

	private async writeFile(filePath: string, data: string): Promise<void> {
		return this.app.vault.adapter.write(filePath, data);
	}

	/** Check if an update is available. */
	async checkForUpdate(
		currentVersion: string,
		includePrerelease: boolean,
		currentCommitHash?: string,
		currentBranch?: string,
	): Promise<UpdateCheckResult> {
		await this.logger.info("Starting update check", {
			currentVersion,
			includePrerelease,
			currentCommitHash,
			currentBranch,
		});

		try {
			let release: ReleaseInfo;

			if (includePrerelease) {
				await this.logger.debug("Fetching releases (dev channel)");
				const releases = (await fetchJson(
					`https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=30`,
				)) as ReleaseInfo[];
				await this.logger.debug("Got releases", { count: releases?.length });
				
				if (!releases || releases.length === 0) {
					await this.logger.error("No releases found");
					return {
						hasUpdate: false,
						currentVersion,
						latestVersion: currentVersion,
						release: null,
						isPrerelease: false,
					};
				}

				let branchRelease: ReleaseInfo | undefined;
				if (currentBranch && currentBranch !== "main") {
					const branchTag = `latest-dev-${currentBranch}`;
					branchRelease = releases.find((r) => r.tag_name === branchTag);
				}

				release = branchRelease ?? releases.find((r) => r.tag_name === "latest-dev") ?? releases.find((r) => r.prerelease) ?? releases[0];
				await this.logger.debug("Selected release", { tag: release.tag_name, prerelease: release.prerelease });
			} else {
				await this.logger.debug("Fetching latest stable release");
				release = await fetchJson(
					`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`,
				);
				await this.logger.debug("Got stable release", { tag: release.tag_name });
			}

			const latestVersion = release.tag_name.replace(/^v/, "");

			await this.logger.debug("Fetching latest commit");
			const latestCommit = await fetchLatestCommit(
				includePrerelease && currentBranch ? currentBranch : "main",
			);
			await this.logger.debug("Got commit", { sha: latestCommit?.sha?.slice(0, 7) });

			let commitMatch = false;
			if (includePrerelease && currentCommitHash && latestCommit) {
				const shortLocal = currentCommitHash.slice(0, 7);
				const shortRemote = latestCommit.sha.slice(0, 7);
				commitMatch = shortLocal === shortRemote;
				await this.logger.info("Commit comparison", { shortLocal, shortRemote, commitMatch });
				if (commitMatch) {
					return {
						hasUpdate: false,
						currentVersion,
						latestVersion,
						release,
						isPrerelease: true,
						commitMatch: true,
						latestCommit,
					};
				}
			}

			// For dev builds, a commit mismatch means there IS an update.
			// Version comparison is unreliable when comparing semver to dev tags.
			const hasUpdate = includePrerelease && currentCommitHash && latestCommit
				? !commitMatch
				: compareVersions(latestVersion, currentVersion) > 0;
			await this.logger.info("Version comparison result", { latestVersion, currentVersion, hasUpdate });

			return {
				hasUpdate,
				currentVersion,
				latestVersion,
				release,
				isPrerelease: release.prerelease,
				commitMatch,
				latestCommit,
			};
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error);
			await this.logger.error("Update check failed", { error: errorMsg, stack: error instanceof Error ? error.stack : undefined });
			console.error("[PluginUpdater] Check failed:", error);
			return {
				hasUpdate: false,
				currentVersion,
				latestVersion: currentVersion,
				release: null,
				isPrerelease: false,
			};
		}
	}

	/** Return all currently published dev builds, one per branch/tag. */
	async listAvailableBuilds(): Promise<AvailableBuild[]> {
		const releases = (await fetchJson(
			`https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=100`,
		)) as ReleaseInfo[];

		const builds: AvailableBuild[] = [];
		for (const release of releases.filter(
			(r) => r.prerelease && r.tag_name.startsWith("latest-dev"),
		)) {
			let commitHash = release.body?.match(/\*\*Commit:\*\*\s*`([^`]+)`/)?.[1];
			let committedAt: string | undefined;

			// Fetch commit info for accurate timestamp
			const branch = branchFromRelease(release);
			try {
				const commitInfo = await fetchLatestCommit(branch);
				if (commitInfo) {
					commitHash = commitInfo.sha;
					committedAt = commitInfo.committedAt;
				}
			} catch {
				// Fallback: try to parse from release body if present
			}

			builds.push({
				release,
				branch,
				commitHash,
				committedAt,
			});
		}
		return builds;
	}

	/** Download update files to a temp directory */
	async downloadUpdate(release: ReleaseInfo): Promise<string> {
		const tempDir = `${this.pluginDir}/.update-tmp`;
		await this.ensureDir(tempDir);

		for (const filename of RELEASE_FILES) {
			const asset = release.assets.find((a) => a.name === filename);
			if (!asset) {
				throw new Error(`Release missing required file: ${filename}`);
			}
			const destPath = `${tempDir}/${filename}`;
			await downloadFile(this.app, asset.browser_download_url, destPath);
		}

		return tempDir;
	}

	/** Install downloaded update files */
	async installUpdate(tempDir: string): Promise<void> {
		const backupDir = `${this.pluginDir}/.backup`;
		await this.ensureDir(backupDir);

		for (const filename of RELEASE_FILES) {
			const currentPath = `${this.pluginDir}/${filename}`;
			const backupPath = `${backupDir}/${filename}`;
			if (await this.fileExists(currentPath)) {
				const content = await this.readFile(currentPath);
				await this.writeFile(backupPath, content);
			}
		}

		for (const filename of RELEASE_FILES) {
			const src = `${tempDir}/${filename}`;
			const dest = `${this.pluginDir}/${filename}`;
			const content = await this.readFile(src);
			await this.writeFile(dest, content);
		}
	}

	/** Rollback to backup files */
	async rollback(): Promise<void> {
		const backupDir = `${this.pluginDir}/.backup`;
		if (!(await this.fileExists(backupDir))) {
			throw new Error("No backup available for rollback");
		}

		for (const filename of RELEASE_FILES) {
			const backupPath = `${backupDir}/${filename}`;
			const dest = `${this.pluginDir}/${filename}`;
			if (await this.fileExists(backupPath)) {
				const content = await this.readFile(backupPath);
				await this.writeFile(dest, content);
			}
		}
	}
}

/** Modal shown when an update is available */
export class UpdateAvailableModal extends Modal {
	private result: "install" | "skip" | null = null;

	constructor(
		app: App,
		private checkResult: UpdateCheckResult,
		private onInstall: () => Promise<void>,
	) {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl("h2", { text: "Update Available" });

		const info = contentEl.createDiv();
		info.createEl("p", {
			text: `Current version: ${this.checkResult.currentVersion}`,
		});
		info.createEl("p", {
			text: `Latest version: ${this.checkResult.latestVersion}`,
		});

		if (this.checkResult.isPrerelease) {
			info.createEl("p", {
				text: "⚠️ This is a pre-release (dev build).",
				cls: "updater-prerelease-warning",
			});
		}

		if (this.checkResult.latestCommit) {
			const commit = this.checkResult.latestCommit;
			contentEl.createEl("h3", { text: "Build information" });
			const buildInfo = contentEl.createDiv("updater-build-info");
			const commitLink = buildInfo.createEl("a", {
				text: commit.sha.slice(0, 7),
				href: `https://github.com/${GITHUB_REPO}/commit/${commit.sha}`,
			});
			commitLink.setAttr("target", "_blank");
			buildInfo.createEl("span", {
				text: ` — ${commit.message || "No commit message"}`,
			});
			buildInfo.createEl("br");
			buildInfo.createEl("span", {
				text: `${commit.authorName ? `${commit.authorName} · ` : ""}${commit.committedAt ? new Date(commit.committedAt).toLocaleString() : "Timestamp unavailable"}`,
			});
		}

		if (this.checkResult.release?.body) {
			contentEl.createEl("h3", { text: "Changelog" });
			const changelog = contentEl.createDiv("updater-changelog");
			changelog.createEl("pre", { text: this.checkResult.release.body });
		}

		new Setting(contentEl)
			.addButton((btn) =>
				btn
					.setButtonText("Install & Reload")
					.setCta()
					.onClick(async () => {
						btn.setDisabled(true);
						btn.setButtonText("Installing…");
						try {
							await this.onInstall();
							this.result = "install";
							this.close();
							new Notice("✅ Update installed. Reloading Obsidian…");
							// @ts-ignore
							this.app.commands.executeCommandById("app:reload");
						} catch (error: any) {
							btn.setButtonText("Install & Reload");
							btn.setDisabled(false);
							new Notice(`❌ Update failed: ${error.message}`);
						}
					}),
			)
			.addButton((btn) =>
				btn.setButtonText("Skip").onClick(() => {
					this.result = "skip";
					this.close();
				}),
			);
	}

	onClose() {
		this.contentEl.empty();
	}

	async awaitChoice(): Promise<"install" | "skip"> {
		return new Promise((resolve) => {
			const check = () => {
				if (this.result !== null) {
					resolve(this.result);
				} else {
					setTimeout(check, 50);
				}
			};
			check();
		});
	}
}

/** Modal for selecting a dev build from any published branch. */
export class AvailableBuildsModal extends Modal {
	private builds: AvailableBuild[] = [];

	constructor(
		app: App,
		private updater: PluginUpdater,
		private onInstall: (build: AvailableBuild) => Promise<void>,
	) {
		super(app);
	}

	async onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h2", { text: "Available dev builds" });
		contentEl.createEl("p", { text: "Choose a branch build to download and install." });
		const status = contentEl.createEl("p", { text: "Loading builds…" });
		try {
			this.builds = await this.updater.listAvailableBuilds();
			status.remove();
			if (this.builds.length === 0) {
				contentEl.createEl("p", { text: "No branch builds are currently available." });
				return;
			}
			for (const build of this.builds) {
				const timestamp = build.committedAt
					? new Date(build.committedAt).toLocaleString()
					: new Date(build.release.published_at).toLocaleString();
				const setting = new Setting(contentEl)
					.setName(build.branch)
					.setDesc(`${build.release.name} · ${build.commitHash?.slice(0, 7) ?? "commit unavailable"} · ${timestamp}`)
					.addButton((button) => button.setButtonText("Install").onClick(async () => {
						button.setDisabled(true);
						button.setButtonText("Installing…");
						try {
							await this.onInstall(build);
							this.close();
							new Notice("✅ Build installed. Reloading Obsidian…");
							// @ts-ignore
							this.app.commands.executeCommandById("app:reload");
						} catch (error: any) {
							button.setDisabled(false);
							button.setButtonText("Install");
							new Notice(`❌ Install failed: ${error.message}`);
						}
					}));
				setting.controlEl.querySelector("button")?.setAttr("aria-label", `Install ${build.branch} build`);
			}
		} catch (error) {
			status.setText(`Could not load builds: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	onClose() {
		this.contentEl.empty();
	}
}
