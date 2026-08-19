/**
 * Core types for Obsidian SyncIt
 */

export interface SyncItSettings {
	webdavUrl: string;
	webdavUsername: string;
	webdavPassword: string;
	remoteBaseDir: string;
	excludePatterns: string[];
	includePatterns: string[];
	confirmBeforeDelete: boolean;
	moveToTrash: boolean;
	checkForUpdates: boolean;
	updateChannel: "stable" | "dev";
	autoUpdate: boolean;
	lastUpdateCheck: number;
	concurrencyLimit: number;
	// Logging
	logLevel: "ERROR" | "WARNING" | "INFO" | "DEBUG";
	logMaxAgeDays: number;
	logMaxSizeMB: number;
	logBackupInPluginDir: boolean;
	syncDirection: ReconciliationMode;
	reconciliationPolicy: "follow-direction" | "prompt";
	downloadOrphanPolicy: "keep" | "delete-local";
	uploadOrphanPolicy: "keep" | "delete-remote";
}

export const DEFAULT_SETTINGS: SyncItSettings = {
	webdavUrl: "",
	webdavUsername: "",
	webdavPassword: "",
	remoteBaseDir: "",
	excludePatterns: [
		".obsidian/",
		".git/",
		".trash/",
		"node_modules/",
	],
	includePatterns: [],
	confirmBeforeDelete: true,
	moveToTrash: true,
	checkForUpdates: true,
	updateChannel: "stable",
	autoUpdate: false,
	lastUpdateCheck: 0,
	concurrencyLimit: 3,
	logLevel: "INFO",
	logMaxAgeDays: 30,
	logMaxSizeMB: 10,
	logBackupInPluginDir: false,
	syncDirection: "two-way",
	reconciliationPolicy: "follow-direction",
	downloadOrphanPolicy: "keep",
	uploadOrphanPolicy: "keep",
};

export interface FileEntity {
	path: string;
	mtime: number;
	size: number;
	etag?: string;
	/** Optional destination used when keeping both sides of a conflict. */
	targetPath?: string;
}

export interface SyncIndexEntry {
	localMtime: number;
	remoteMtime: number;
	localSize: number;
	remoteSize: number;
	etag: string;
}

export interface SyncIndex {
	lastSyncTime: number;
	serverSignature: string; // hash of server config to detect changes
	files: Record<string, SyncIndexEntry>;
}

export interface SyncPlan {
	uploads: FileEntity[];
	downloads: FileEntity[];
	localDeletes: FileEntity[];
	remoteDeletes: FileEntity[];
	conflicts: Array<{ local: FileEntity; remote: FileEntity }>;
	reconciliation: ReconciliationItem[];
	requiresReconciliation: boolean;
	unchanged: number;
	// Size totals for progress
	uploadSize: number;
	downloadSize: number;
}

export type ReconciliationReason =
	| "no-baseline-local-only"
	| "no-baseline-remote-only"
	| "no-baseline-conflict"
	| "possible-remote-deletion"
	| "possible-local-deletion";

export interface ReconciliationItem {
	path: string;
	reason: ReconciliationReason;
	local?: FileEntity;
	remote?: FileEntity;
}

export type ReconciliationDecision = "use-local" | "use-remote" | "keep-both" | "skip";

export type ReconciliationMode = "two-way" | "upload-only" | "download-only";

export interface SyncResult {
	uploaded: number;
	downloaded: number;
	deleted: number;
	conflicts: number;
	skipped: number;
	errors: string[];
	// Size totals for progress
	uploadedBytes: number;
	downloadedBytes: number;
}

export interface WebDAVConfig {
	url: string;
	username: string;
	password: string;
	baseDir: string;
}
