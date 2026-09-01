/**
 * SyncLogger — structured JSONL logging with bounded reads and purge-in-place
 * retention.
 *
 * Canonical location: .syncit/log.jsonl
 * Optional backup: .obsidian/plugins/obsidian-syncit/sync-log.jsonl
 */

export type LogLevel = "ERROR" | "WARNING" | "INFO" | "DEBUG";

export interface LogEntry {
	timestamp: string;
	level: LogLevel;
	category: string;
	message: string;
	details?: Record<string, unknown>;
}

export interface LogQuery {
	level?: LogLevel;
	category?: string;
	search?: string;
	session?: string;
	from?: string;
	to?: string;
	limit?: number;
	cursor?: number;
}

export interface LogPage {
	entries: LogEntry[];
	nextCursor: number | null;
	totalEntries: number;
	matchingEntries: number;
	counts: Record<LogLevel, number>;
	parseErrors: number;
}

export interface LoggerStorage {
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

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Remove common credential and authorization forms before persistence/display. */
export function sanitizeLogText(value: string): string {
	return value
		.replace(/(authorization\s*:\s*)(?:(?:Bearer|Basic)\s+)?[^\s,;]+/gi, "$1[REDACTED]")
		.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
		.replace(/\bBasic\s+[A-Za-z0-9+/=]+/gi, "Basic [REDACTED]")
		.replace(/(https?:\/\/)[^/\s:@]+:[^@\s]+@/gi, "$1[REDACTED]@")
		.replace(/\b(password|passwd|token|api[-_]?key|secret)(\s*[:=]\s*)[^,\s}]+/gi, "$1$2[REDACTED]");
}

function sanitizeDetails(value: unknown, key?: string): unknown {
	if (key && /password|passwd|token|secret|authorization|api[-_]?key/i.test(key)) return "[REDACTED]";
	if (typeof value === "string") return sanitizeLogText(value);
	if (Array.isArray(value)) return value.map((item) => sanitizeDetails(item));
	if (value && typeof value === "object") {
		const result: Record<string, unknown> = {};
		for (const [childKey, childValue] of Object.entries(value)) result[childKey] = sanitizeDetails(childValue, childKey);
		return result;
	}
	return value;
}

function safeDetails(details?: Record<string, unknown>): Record<string, unknown> | undefined {
	return details ? sanitizeDetails(details) as Record<string, unknown> : undefined;
}

function parseLogLine(line: string): LogEntry | null {
	try {
		const parsed = JSON.parse(line) as Partial<LogEntry>;
		if (
			typeof parsed.timestamp !== "string" ||
			typeof parsed.level !== "string" ||
			!(parsed.level in LEVEL_ORDER) ||
			typeof parsed.category !== "string" ||
			typeof parsed.message !== "string" ||
			!Number.isFinite(Date.parse(parsed.timestamp))
		) return null;
		return {
			timestamp: parsed.timestamp,
			level: parsed.level as LogLevel,
			category: parsed.category,
			message: sanitizeLogText(parsed.message),
			details: safeDetails(parsed.details),
		};
	} catch {
		return null;
	}
}

function serializeEntries(entries: LogEntry[]): string {
	return entries.length > 0 ? `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n` : "";
}

function byteLength(value: string): number {
	return new Blob([value]).size;
}

export class SyncLogger {
	private readonly canonicalPath = ".syncit/log.jsonl";
	private readonly pluginDirPath: string;
	private backupPath: string | null;
	private readonly storage: LoggerStorage;
	private minLevel: LogLevel;
	private maxAgeDays: number;
	private maxSizeMB: number;
	private keepBackup: boolean;
	private writeQueue: string[] = [];
	private flushTimer: ReturnType<typeof setTimeout> | null = null;
	private flushPromise: Promise<void> | null = null;

	constructor(options: {
		pluginDirPath: string;
		storage: LoggerStorage;
		minLevel: LogLevel;
		maxAgeDays: number;
		maxSizeMB: number;
		keepBackup: boolean;
	}) {
		this.pluginDirPath = options.pluginDirPath;
		this.backupPath = options.keepBackup ? `${options.pluginDirPath}/sync-log.jsonl` : null;
		this.storage = options.storage;
		this.minLevel = options.minLevel;
		this.maxAgeDays = Math.max(1, options.maxAgeDays);
		this.maxSizeMB = Math.max(0.001, options.maxSizeMB);
		this.keepBackup = options.keepBackup;
	}

	/** Apply settings to the active logger without requiring a plugin restart. */
	async updateSettings(settings: {
		minLevel?: LogLevel;
		maxAgeDays?: number;
		maxSizeMB?: number;
		keepBackup?: boolean;
	}): Promise<void> {
		await this.flush();
		const backupChanged = settings.keepBackup !== undefined && settings.keepBackup !== this.keepBackup;
		if (settings.minLevel !== undefined) this.minLevel = settings.minLevel;
		if (settings.maxAgeDays !== undefined) this.maxAgeDays = Math.max(1, settings.maxAgeDays);
		if (settings.maxSizeMB !== undefined) this.maxSizeMB = Math.max(0.001, settings.maxSizeMB);
		if (settings.keepBackup !== undefined) this.keepBackup = settings.keepBackup;

		this.backupPath = this.keepBackup ? `${this.pluginDirPath}/sync-log.jsonl` : null;
		if (backupChanged && this.keepBackup && this.backupPath) {
			await this.copyCanonicalToBackup(this.backupPath);
		} else if (backupChanged && !this.keepBackup) {
			const oldPath = `${this.pluginDirPath}/sync-log.jsonl`;
			if (await this.storage.exists(oldPath)) await this.storage.remove(oldPath);
		}

		// A lower size or age limit must take effect even if no new entry arrives.
		await this.rotateAndSyncBackup();
	}

	private shouldLog(level: LogLevel): boolean {
		return LEVEL_ORDER[level] <= LEVEL_ORDER[this.minLevel];
	}

	async log(level: LogLevel, category: string, message: string, details?: Record<string, unknown>): Promise<void> {
		if (!this.shouldLog(level)) return;
		const entry: LogEntry = {
			timestamp: new Date().toISOString(),
			level,
			category: sanitizeLogText(category),
			message: sanitizeLogText(message),
			details: safeDetails(details),
		};
		this.writeQueue.push(`${JSON.stringify(entry)}\n`);
		if (this.flushTimer !== null) clearTimeout(this.flushTimer);
		this.flushTimer = setTimeout(() => { void this._flush(); }, 100);
	}

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

	private async _flush(): Promise<void> {
		if (this.flushPromise) return this.flushPromise;
		this.flushPromise = this.drainQueue().finally(() => { this.flushPromise = null; });
		return this.flushPromise;
	}

	private async drainQueue(): Promise<void> {
		if (this.flushTimer !== null) {
			clearTimeout(this.flushTimer);
			this.flushTimer = null;
		}
		while (this.writeQueue.length > 0) {
			const lines = this.writeQueue.splice(0).join("");
			try {
				await this._appendToFile(this.canonicalPath, lines);
				await this.rotateAndSyncBackup();
				this.writeDebug(`[SyncIt Logger] Flushed ${lines.split("\\n").filter(Boolean).length} entries`);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				const safeMessage = sanitizeLogText(message);
				console.error(`[SyncIt Logger] Failed to write log: ${safeMessage}`);
				this.writeDebug(`[SyncIt Logger] Failed to write log: ${safeMessage}`);
			}
		}
	}

	private writeDebug(message: string): void {
		const debugPath = ".obsidian/plugins/obsidian-syncit/debug.log";
		void this.storage.exists(debugPath)
			.then((exists) => exists ? this.storage.read(debugPath) : "")
			.then((existing) => this.storage.write(debugPath, `${existing}[${new Date().toISOString()}] ${sanitizeLogText(message)}\n`))
			.catch(() => {
				// Diagnostics must never interfere with syncing or logging.
			});
	}

	private async _appendToFile(path: string, data: string): Promise<void> {
		const existing = await this.storage.exists(path) ? await this.storage.read(path) : "";
		await this.storage.write(path, existing + data);
	}

	private async rotateAndSyncBackup(): Promise<void> {
		if (await this.storage.exists(this.canonicalPath)) await this.maybeRotate(this.canonicalPath);
		if (this.keepBackup && this.backupPath) await this.copyCanonicalToBackup(this.backupPath);
	}

	private async copyCanonicalToBackup(path: string): Promise<void> {
		const content = await this.storage.exists(this.canonicalPath) ? await this.storage.read(this.canonicalPath) : "";
		await this.storage.write(path, content);
	}

	/** Purge in place: remove old/malformed lines, then trim oldest valid lines. */
	private async maybeRotate(path: string): Promise<void> {
		const content = await this.storage.read(path);
		const rawLines = content.split("\n").filter((line) => line.trim().length > 0);
		const validEntries = rawLines.map(parseLogLine).filter((entry): entry is LogEntry => entry !== null);
		const cutoff = Date.now() - this.maxAgeDays * DAY_MS;
		const freshEntries = validEntries.filter((entry) => Date.parse(entry.timestamp) >= cutoff);
		const ageOrMalformedNeedsPurge = freshEntries.length !== rawLines.length;
		const sizeExceeded = byteLength(content) > this.maxSizeMB * 1024 * 1024;
		if (!ageOrMalformedNeedsPurge && !sizeExceeded) return;

		const targetBytes = this.maxSizeMB * 1024 * 1024 * 0.8;
		const kept = [...freshEntries];
		while (kept.length > 0 && byteLength(serializeEntries(kept)) > targetBytes) kept.shift();
		await this.storage.write(path, serializeEntries(kept));
	}

	/** Read a deterministic newest-first page. The UI should use this contract, not the raw file. */
	async readPage(query: LogQuery = {}): Promise<LogPage> {
		await this._flush();
		try {
			if (!(await this.storage.exists(this.canonicalPath))) return emptyPage();
			const content = await this.storage.read(this.canonicalPath);
			const lines = content.split("\n").filter((line) => line.trim().length > 0);
			const allEntries: LogEntry[] = [];
			let parseErrors = 0;
			for (const line of lines) {
				const entry = parseLogLine(line);
				if (entry) allEntries.push(entry); else parseErrors++;
			}

			const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(query.limit ?? DEFAULT_PAGE_SIZE)));
			const startIndex = query.cursor === undefined
				? lines.length - 1
				: Math.min(lines.length - 1, Math.max(-1, Math.floor(query.cursor)));
			const filtered = allEntries.filter((entry) => matchesQuery(entry, query));
			const counts: Record<LogLevel, number> = { ERROR: 0, WARNING: 0, INFO: 0, DEBUG: 0 };
			for (const entry of filtered) counts[entry.level]++;

			const entries: LogEntry[] = [];
			let nextCursor: number | null = null;
			for (let lineIndex = startIndex; lineIndex >= 0; lineIndex--) {
				const entry = parseLogLine(lines[lineIndex]);
				if (!entry || !matchesQuery(entry, query)) continue;
				entries.push(entry);
				if (entries.length >= limit) {
					nextCursor = lineIndex - 1 >= 0 ? lineIndex - 1 : null;
					break;
				}
			}
			return {
				entries,
				nextCursor,
				totalEntries: allEntries.length,
				matchingEntries: filtered.length,
				counts,
				parseErrors,
			};
		} catch {
			return emptyPage();
		}
	}

	async readEntries(query: LogQuery = {}): Promise<LogEntry[]> {
		return (await this.readPage(query)).entries;
	}

	async readSessionGroups(limit = DEFAULT_PAGE_SIZE): Promise<{ startTime: string; entries: LogEntry[] }[]> {
		const entries = await this.readEntries({ limit });
		const groups: { startTime: string; entries: LogEntry[] }[] = [];
		let current: LogEntry[] = [];
		let lastTime = 0;
		for (const entry of entries) {
			const time = Date.parse(entry.timestamp);
			if (current.length > 0 && lastTime - time > 5 * 60 * 1000) {
				groups.push({ startTime: current[0].timestamp, entries: current });
				current = [];
			}
			current.push(entry);
			lastTime = time;
		}
		if (current.length > 0) groups.push({ startTime: current[0].timestamp, entries: current });
		return groups;
	}

	async clear(): Promise<void> {
		await this.flush();
		if (await this.storage.exists(this.canonicalPath)) await this.storage.write(this.canonicalPath, "");
		if (this.backupPath && await this.storage.exists(this.backupPath)) await this.storage.write(this.backupPath, "");
	}

	async flush(): Promise<void> {
		await this._flush();
	}
}

function matchesQuery(entry: LogEntry, query: LogQuery): boolean {
	if (query.level && entry.level !== query.level) return false;
	if (query.category && entry.category !== query.category) return false;
	const sessionId = entry.details?.sessionId ?? entry.details?.session;
	if (query.session && String(sessionId ?? "") !== query.session) return false;
	const timestamp = Date.parse(entry.timestamp);
	if (query.from && timestamp < Date.parse(query.from)) return false;
	if (query.to && timestamp > Date.parse(query.to)) return false;
	if (query.search) {
		const search = query.search.toLowerCase();
		const text = `${entry.timestamp} ${entry.level} ${entry.category} ${entry.message} ${JSON.stringify(entry.details ?? {})}`.toLowerCase();
		if (!text.includes(search)) return false;
	}
	return true;
}

function emptyPage(): LogPage {
	return {
		entries: [],
		nextCursor: null,
		totalEntries: 0,
		matchingEntries: 0,
		counts: { ERROR: 0, WARNING: 0, INFO: 0, DEBUG: 0 },
		parseErrors: 0,
	};
}
