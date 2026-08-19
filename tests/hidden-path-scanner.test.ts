import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => ({
	TFile: class MockTFile {},
}));

import { VaultScanner } from "../src/local/VaultScanner";
import { HiddenPathScanner } from "../src/local/HiddenPathScanner";
import type { SyncItSettings } from "../src/types";

function makeSettings(overrides: Partial<SyncItSettings> = {}): SyncItSettings {
	return {
		webdavUrl: "",
		webdavUsername: "",
		webdavPassword: "",
		remoteBaseDir: "",
		excludePatterns: [".obsidian/"],
		includePatterns: [],
		confirmBeforeDelete: false,
		moveToTrash: false,
		checkForUpdates: false,
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
		...overrides,
	};
}

function createScanner(settings: SyncItSettings) {
	const adapter = {
		exists: vi.fn().mockResolvedValue(false),
		mkdir: vi.fn().mockResolvedValue(undefined),
		write: vi.fn().mockResolvedValue(undefined),
		rename: vi.fn().mockResolvedValue(undefined),
		remove: vi.fn().mockResolvedValue(undefined),
		list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
		stat: vi.fn().mockResolvedValue(null),
	};
	const vault = {
		adapter,
		getFiles: vi.fn().mockReturnValue([]),
		getAbstractFileByPath: vi.fn().mockReturnValue(null),
	};
	return {
		scanner: new VaultScanner({ vault } as never, settings),
		adapter,
		vault,
	};
}

describe("VaultScanner hidden path integration", () => {
	it("returns only standard files when includePatterns is empty", async () => {
		const settings = makeSettings({ includePatterns: [] });
		const { scanner, vault } = createScanner(settings);
		vault.getFiles.mockReturnValue([
			{ path: "note.md", stat: { mtime: 1000, size: 10 } },
		]);

		const files = await scanner.scan();
		expect(files).toHaveLength(1);
		expect(files[0].path).toBe("note.md");
	});

	it("merges hidden path files with standard files", async () => {
		const settings = makeSettings({
			includePatterns: [".obsidian/plugins/obsidian-ai/sessions/"],
		});
		const { scanner, vault, adapter } = createScanner(settings);

		vault.getFiles.mockReturnValue([
			{ path: "note.md", stat: { mtime: 1000, size: 10 } },
		]);

		adapter.list.mockResolvedValue({
			files: [".obsidian/plugins/obsidian-ai/sessions/session-1.json"],
			folders: [],
		});
		adapter.stat.mockResolvedValue({
			type: "file",
			mtime: 2000,
			size: 20,
		});

		const files = await scanner.scan();
		const paths = files.map((f) => f.path);
		expect(paths).toContain("note.md");
		expect(paths).toContain(".obsidian/plugins/obsidian-ai/sessions/session-1.json");
	});

	it("skips blocklisted files in hidden paths", async () => {
		const settings = makeSettings({
			includePatterns: [".obsidian/plugins/obsidian-ai/sessions/"],
		});
		const { scanner, adapter } = createScanner(settings);

		adapter.list.mockResolvedValue({
			files: [
				".obsidian/plugins/obsidian-ai/sessions/session-1.json",
				".obsidian/plugins/obsidian-ai/sessions/data.json",
				".obsidian/plugins/obsidian-ai/sessions/plugin.js",
			],
			folders: [],
		});
		adapter.stat.mockResolvedValue({
			type: "file",
			mtime: 2000,
			size: 20,
		});

		const files = await scanner.scan();
		const paths = files.map((f) => f.path);
		expect(paths).toContain(".obsidian/plugins/obsidian-ai/sessions/session-1.json");
		expect(paths).not.toContain(".obsidian/plugins/obsidian-ai/sessions/data.json");
		expect(paths).not.toContain(".obsidian/plugins/obsidian-ai/sessions/plugin.js");
	});

	it("still applies excludePatterns to standard files", async () => {
		const settings = makeSettings({
			excludePatterns: [".obsidian/", "temp/"],
			includePatterns: [".obsidian/plugins/obsidian-ai/sessions/"],
		});
		const { scanner, vault, adapter } = createScanner(settings);

		vault.getFiles.mockReturnValue([
			{ path: "note.md", stat: { mtime: 1000, size: 10 } },
			{ path: "temp/draft.md", stat: { mtime: 1000, size: 10 } },
		]);

		adapter.list.mockResolvedValue({
			files: [".obsidian/plugins/obsidian-ai/sessions/session-1.json"],
			folders: [],
		});
		adapter.stat.mockResolvedValue({
			type: "file",
			mtime: 2000,
			size: 20,
		});

		const files = await scanner.scan();
		const paths = files.map((f) => f.path);
		expect(paths).toContain("note.md");
		expect(paths).toContain(".obsidian/plugins/obsidian-ai/sessions/session-1.json");
		expect(paths).not.toContain("temp/draft.md");
	});
});

describe("HiddenPathScanner", () => {
	function createHiddenScanner(includePatterns: string[]) {
		const adapter = {
			list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
			stat: vi.fn().mockResolvedValue(null),
		};
		return {
			scanner: new HiddenPathScanner({ vault: { adapter } } as never, includePatterns),
			adapter,
		};
	}

	it("validates path traversal", () => {
		const { scanner } = createHiddenScanner([]);
		expect(scanner.validatePattern(".obsidian/../secret/")).toContain("traversal");
	});

	it("validates paths must be under .obsidian/", () => {
		const { scanner } = createHiddenScanner([]);
		expect(scanner.validatePattern("secret/")).toContain(".obsidian/");
	});

	it("rejects bare .obsidian/", () => {
		const { scanner } = createHiddenScanner([]);
		expect(scanner.validatePattern(".obsidian/")).toContain("entire");
	});

	it("rejects paths that do not end with /", () => {
		const { scanner } = createHiddenScanner([]);
		expect(scanner.validatePattern(".obsidian/plugins/foo")).toContain("directory");
	});

	it("returns undefined for valid patterns", () => {
		const { scanner } = createHiddenScanner([]);
		expect(scanner.validatePattern(".obsidian/plugins/obsidian-ai/sessions/")).toBeUndefined();
	});

	it("blocklists known plugin file types", () => {
		const { scanner } = createHiddenScanner([]);
		expect(scanner.isBlocklisted("manifest.json")).toBe(true);
		expect(scanner.isBlocklisted("data.json")).toBe(true);
		expect(scanner.isBlocklisted("hot-reload.json")).toBe(true);
		expect(scanner.isBlocklisted("plugin.js")).toBe(true);
		expect(scanner.isBlocklisted("style.css")).toBe(true);
		expect(scanner.isBlocklisted("code.mjs")).toBe(true);
		expect(scanner.isBlocklisted("session.md")).toBe(false);
	});

	it("blocklists files directly inside plugin roots", () => {
		const { scanner } = createHiddenScanner([]);
		expect(scanner.isBlocklisted(".obsidian/plugins/foo/manifest.json")).toBe(true);
		expect(scanner.isBlocklisted(".obsidian/plugins/foo/main.js")).toBe(true);
		expect(scanner.isBlocklisted(".obsidian/plugins/foo/README.md")).toBe(true);
		expect(scanner.isBlocklisted(".obsidian/plugins/foo/sessions/session.json")).toBe(false);
	});

	it("recursively lists directories and respects plugin root blocklist", async () => {
		const { scanner, adapter } = createHiddenScanner([".obsidian/plugins/foo/"]);

		adapter.list.mockImplementation(async (path: string) => {
			if (path === ".obsidian/plugins/foo/") {
				return {
					files: [
						".obsidian/plugins/foo/a.md",
						".obsidian/plugins/foo/manifest.json",
					],
					folders: [".obsidian/plugins/foo/sub/"],
				};
			}
			if (path === ".obsidian/plugins/foo/sub/") {
				return {
					files: [".obsidian/plugins/foo/sub/b.md"],
					folders: [],
				};
			}
			return { files: [], folders: [] };
		});

		adapter.stat.mockResolvedValue({ type: "file", mtime: 1, size: 1 });

		const files = await scanner.scan();
		const paths = files.map((f) => f.path);
		// a.md is directly in plugin root → blocklisted
		expect(paths).not.toContain(".obsidian/plugins/foo/a.md");
		expect(paths).not.toContain(".obsidian/plugins/foo/manifest.json");
		// b.md is in a subdirectory → allowed
		expect(paths).toContain(".obsidian/plugins/foo/sub/b.md");
	});
});
