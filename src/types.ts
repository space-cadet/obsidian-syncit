/**
 * Core types for Obsidian SyncIt
 */

export interface SyncItSettings {
	webdavUrl: string;
	webdavUsername: string;
	webdavPassword: string;
	remoteBaseDir: string;
	excludePatterns: string[];
	confirmBeforeDelete: boolean;
	moveToTrash: boolean;
	checkForUpdates: boolean;
	updateChannel: "stable" | "dev";
	autoUpdate: boolean;
	lastUpdateCheck: number;
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
	confirmBeforeDelete: true,
	moveToTrash: true,
	checkForUpdates: true,
	updateChannel: "stable",
	autoUpdate: false,
	lastUpdateCheck: 0,
};

export interface FileEntity {
	path: string;
	mtime: number;
	size: number;
}

export interface SyncPlan {
	uploads: FileEntity[];
	downloads: FileEntity[];
	localDeletes: FileEntity[];
	remoteDeletes: FileEntity[];
	conflicts: Array<{ local: FileEntity; remote: FileEntity }>;
	unchanged: number;
}

export interface SyncResult {
	uploaded: number;
	downloaded: number;
	deleted: number;
	conflicts: number;
	skipped: number;
	errors: string[];
}

export interface WebDAVConfig {
	url: string;
	username: string;
	password: string;
	baseDir: string;
}
