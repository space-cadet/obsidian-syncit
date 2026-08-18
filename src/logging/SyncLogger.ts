/**
 * SyncLogger — structured JSONL logging with rotation
 *
 * Canonical location: .syncit/log.jsonl
 * Optional backup: .obsidian/plugins/obsidian-syncit/sync-log.jsonl
 */

export type LogLevel = "ERROR" | "WARNING" | "INFO" | "DEBUG";

export interface LogEntry {
	timestamp: string; // ISO-8601
	level: LogLevel;
	category: string;
	message: string;
	/** Optional structured data */
	details?: Record<string, unknown>;
}

interface LoggerStorage {
	exists(path: string): Promise<boolean>;
	read(path: string): Promise<string>;
	write(path: string, data: string): Promise<void>;
	remove(path: string): Promise<void>;
}

const LEVEL_ORDER: Record<LogLevel, number> = {
	ERROR: 0,
	WARNING: 1,
	INFO: 2,
	DEBUG: 3,
};

export class SyncLogger {
	private canonicalPath: string;
	private backupPath: string | null = null;
	private storage: LoggerStorage;
	private minLevel: LogLevel;
	private maxAgeDays: number;
	private maxSizeMB: number;
	private keepBackup: boolean;
	private writeQueue: string[] = [];
	private flushTimer: number | null = null;

	constructor(options: {
		vaultBasePath: string;
		pluginDirPath: string;
		storage: LoggerStorage;
		minLevel: LogLevel;
		maxAgeDays: number;
		maxSizeMB: number;
		keepBackup: boolean;
	}) {
		this.canonicalPath = `${options.vaultBasePath}/.syncit/log.jsonl`;
		this.backupPath = options.keepBackup
			? `${options.pluginDirPath}/sync-log.jsonl`
			: null;
		this.storage = options.storage;
		this.minLevel = options.minLevel;
		this.maxAgeDays = options.maxAgeDays;
		this.maxSizeMB = options.maxSizeMB;
		this.keepBackup = options.keepBackup;
	}

	/** Update settings dynamically */
	updateSettings(settings: {
		minLevel?: LogLevel;
		maxAgeDays?: number;
		maxSizeMB?: number;
		keepBackup?: boolean;
	}) {
		if (settings.minLevel !== undefined) this.minLevel = settings.minLevel;
		if (settings.maxAgeDays !== undefined) this.maxAgeDays = settings.maxAgeDays;
		if (settings.maxSizeMB !== undefined) this.maxSizeMB = settings.maxSizeMB;
		if (settings.keepBackup !== undefined) {
			this.keepBackup = settings.keepBackup;
			// Don't change backupPath immediately — handled on next write
		}
	}

	/** Check if a level should be logged */
	private shouldLog(level: LogLevel): boolean {
		return LEVEL_ORDER[level] <= LEVEL_ORDER[this.minLevel];
	}

	/** Main log method */
	async log(level: LogLevel, category: string, message: string, details?: Record<string, unknown>): Promise<void> {
		if (!this.shouldLog(level)) return;

		const entry: LogEntry = {
			timestamp: new Date().toISOString(),
			level,
			category,
			message,
			details,
		};

		const line = JSON.stringify(entry) + "\n";
		this.writeQueue.push(line);

		// Debounce flush to batch writes
		if (this.flushTimer !== null) {
			window.clearTimeout(this.flushTimer);
		}
		this.flushTimer = window.setTimeout(() => {
			void this._flush();
		}, 100);
	}

	/** Convenience methods */
	async error(category: string, message: string, details?: Record<string, unknown>): Promise<void> {
		await this.log("ERROR", category, message, details);
	}
	async warn(category: string, message: string, details?: Record<string, unknown>): Promise<void> {
		await this.log("WARNING", category, message, details);
	}
	async info(category: string, message: string, details?: Record<string, unknown>): Promise<void> {
		await this.log("INFO", category, message, details);
	}
	async debug(category: string, message: string, details?: Record<string, unknown>): Promise<void> {
		await this.log("DEBUG", category, message, details);
	}

	/** Flush queued writes to disk */
	private async _flush(): Promise<void> {
		if (this.writeQueue.length === 0) return;

		const lines = this.writeQueue.join("");
		this.writeQueue = [];
		this.flushTimer = null;

		try {
			await this._appendToFile(this.canonicalPath, lines);
			if (this.keepBackup && this.backupPath) {
				await this._appendToFile(this.backupPath, lines);
			}
		} catch (err) {
			// Silently fail — logging should never break sync
			console.warn("SyncIt: Failed to write log:", err);
		}
	}

	private async _appendToFile(path: string, data: string): Promise<void> {
		const exists = await this.storage.exists(path);
		const existing = exists ? await this.storage.read(path) : "";
		await this.storage.write(path, existing + data);

		// Check rotation after write
		await this._maybeRotate(path);
	}

	/** Rotate log if size or age threshold exceeded */
	private async _maybeRotate(path: string): Promise<void> {
		try {
			const content = await this.storage.read(path);
			const lines = content.split("\n").filter(l => l.trim());

			// Size check
			const sizeMB = new Blob([content]).size / (1024 * 1024);
			const sizeExceeded = sizeMB > this.maxSizeMB;

			// Age check
			const cutoff = new Date(Date.now() - this.maxAgeDays * 24 * 60 * 60 * 1000);
			let ageExceeded = false;
			if (lines.length > 0) {
				try {
					const firstEntry = JSON.parse(lines[0]) as LogEntry;
					ageExceeded = new Date(firstEntry.timestamp) < cutoff;
				} catch {
					// Ignore parse errors
				}
			}

			if (sizeExceeded || ageExceeded) {
				// Keep last N entries based on age
				const kept = lines.filter((line) => {
					try {
						const entry = JSON.parse(line) as LogEntry;
						return new Date(entry.timestamp) >= cutoff;
					} catch {
						return true;
					}
				});

				// If still too big after age purge, truncate from oldest
				while (kept.length > 0) {
					const testContent = kept.join("\n") + (kept.length > 0 ? "\n" : "");
					const testSizeMB = new Blob([testContent]).size / (1024 * 1024);
					if (testSizeMB <= this.maxSizeMB * 0.8) break; // target 80% of max
					kept.shift();
				}

				await this.storage.write(path, kept.join("\n") + (kept.length > 0 ? "\n" : ""));
			}
		} catch {
			// Silently fail rotation
		}
	}

	/** Read all log entries (newest first) */
	async readEntries(filter?: {
		level?: LogLevel;
		category?: string;
		search?: string;
		limit?: number;
	}): Promise<LogEntry[]> {
		await this._flush(); // Ensure all queued writes are persisted

		try {
			const exists = await this.storage.exists(this.canonicalPath);
			if (!exists) return [];

			const content = await this.storage.read(this.canonicalPath);
			const lines = content.split("\n").filter(l => l.trim());

			const entries: LogEntry[] = [];
			for (let i = lines.length - 1; i >= 0; i--) {
				try {
					const entry = JSON.parse(lines[i]) as LogEntry;

					if (filter?.level && LEVEL_ORDER[entry.level] > LEVEL_ORDER[filter.level]) continue;
					if (filter?.category && entry.category !== filter.category) continue;
					if (filter?.search) {
						const s = filter.search.toLowerCase();
						const text = `${entry.message} ${entry.category} ${JSON.stringify(entry.details ?? {})}`.toLowerCase();
						if (!text.includes(s)) continue;
					}

					entries.push(entry);
					if (filter?.limit && entries.length >= filter.limit) break;
				} catch {
					// Skip malformed lines
				}
			}

			return entries;
		} catch {
			return [];
		}
	}

	/** Group entries by sync session (grouped by 5-minute gaps) */
	async readSessionGroups(): Promise<{ startTime: string; entries: LogEntry[] }[]> {
		const entries = await this.readEntries();
		if (entries.length === 0) return [];

		const groups: { startTime: string; entries: LogEntry[] }[] = [];
		let currentGroup: LogEntry[] = [];
		let lastTime = new Date(entries[0].timestamp).getTime();

		for (const entry of entries) {
			const entryTime = new Date(entry.timestamp).getTime();
			if (entryTime - lastTime > 5 * 60 * 1000) {
				if (currentGroup.length > 0) {
					groups.push({
						startTime: currentGroup[0].timestamp,
						entries: currentGroup,
					});
				}
				currentGroup = [];
			}
			currentGroup.push(entry);
			lastTime = entryTime;
		}

		if (currentGroup.length > 0) {
			groups.push({
				startTime: currentGroup[0].timestamp,
				entries: currentGroup,
			});
		}

		return groups;
	}

	/** Clear all logs */
	async clear(): Promise<void> {
		await this._flush();
		try {
			if (await this.storage.exists(this.canonicalPath)) {
				await this.storage.write(this.canonicalPath, "");
			}
			if (this.backupPath && await this.storage.exists(this.backupPath)) {
				await this.storage.write(this.backupPath, "");
			}
		} catch {
			// Silently fail
		}
	}

	/** Force immediate flush (use before reading) */
	async flush(): Promise<void> {
		if (this.flushTimer !== null) {
			window.clearTimeout(this.flushTimer);
			this.flushTimer = null;
		}
		await this._flush();
	}
}
