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

	it("with includes returns merged results (vault + session files)", async () => {
		const settings = makeSettings({
			includePatterns: [".obsidian/plugins/obsidian-ai/sessions/"],
		});
		const { scanner, vault, adapter } = createScanner(settings);

		vault.getFiles.mockReturnValue([
			{ path: "note.md", stat: { mtime: 1000, size: 10 } },
			{ path: "todo.md", stat: { mtime: 1001, size: 11 } },
		]);

		adapter.list.mockImplementation(async (path: string) => {
			if (path === ".obsidian/plugins/obsidian-ai/sessions/") {
				return {
					files: [
						".obsidian/plugins/obsidian-ai/sessions/session-001.json",
						".obsidian/plugins/obsidian-ai/sessions/session-002.json",
					],
					folders: [],
				};
			}
			return { files: [], folders: [] };
		});
		adapter.stat.mockResolvedValue({
			type: "file",
			mtime: 2000,
			size: 20,
		});

		const files = await scanner.scan();
		const paths = files.map((f) => f.path);
		expect(paths).toContain("note.md");
		expect(paths).toContain("todo.md");
		expect(paths).toContain(".obsidian/plugins/obsidian-ai/sessions/session-001.json");
		expect(paths).toContain(".obsidian/plugins/obsidian-ai/sessions/session-002.json");
		expect(files).toHaveLength(4);
	});

	it("without includes returns only vault files", async () => {
		const settings = makeSettings({ includePatterns: [] });
		const { scanner, vault } = createScanner(settings);

		vault.getFiles.mockReturnValue([
			{ path: "note.md", stat: { mtime: 1000, size: 10 } },
			{ path: "todo.md", stat: { mtime: 1001, size: 11 } },
		]);

		const files = await scanner.scan();
		const paths = files.map((f) => f.path);
		expect(paths).toContain("note.md");
		expect(paths).toContain("todo.md");
		expect(paths).not.toContain(".obsidian/plugins/obsidian-ai/sessions/session-001.json");
		expect(files).toHaveLength(2);
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

	it("blocklists core Obsidian settings files", () => {
		const { scanner } = createHiddenScanner([]);
		expect(scanner.isBlocklisted(".obsidian/app.json")).toBe(true);
		expect(scanner.isBlocklisted(".obsidian/appearance.json")).toBe(true);
		expect(scanner.isBlocklisted(".obsidian/workspace.json")).toBe(true);
		// app.json inside a plugin root is also blocked by the plugin-root regex
		expect(scanner.isBlocklisted(".obsidian/plugins/foo/app.json")).toBe(true);
		// But app.json elsewhere is allowed
		expect(scanner.isBlocklisted("sessions/app.json")).toBe(false);
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

	it("valid session path filters out blocklisted file types", async () => {
		const { scanner, adapter } = createHiddenScanner([
			".obsidian/plugins/obsidian-ai/sessions/",
		]);

		adapter.list.mockResolvedValue({
			files: [
				".obsidian/plugins/obsidian-ai/sessions/session-001.json",
				".obsidian/plugins/obsidian-ai/sessions/session-002.json",
				".obsidian/plugins/obsidian-ai/sessions/config.css",
				".obsidian/plugins/obsidian-ai/sessions/plugin.js",
				".obsidian/plugins/obsidian-ai/sessions/hot-reload.json",
			],
			folders: [],
		});
		adapter.stat.mockResolvedValue({ type: "file", mtime: 1, size: 1 });

		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		const files = await scanner.scan();
		warnSpy.mockRestore();

		const paths = files.map((f) => f.path);
		expect(paths).toContain(".obsidian/plugins/obsidian-ai/sessions/session-001.json");
		expect(paths).toContain(".obsidian/plugins/obsidian-ai/sessions/session-002.json");
		// Blocked by extension or basename
		expect(paths).not.toContain(".obsidian/plugins/obsidian-ai/sessions/config.css");
		expect(paths).not.toContain(".obsidian/plugins/obsidian-ai/sessions/plugin.js");
		expect(paths).not.toContain(".obsidian/plugins/obsidian-ai/sessions/hot-reload.json");
		expect(files).toHaveLength(2);
	});

	it("blocked files are filtered out even if in includePatterns", async () => {
		const { scanner, adapter } = createHiddenScanner([
			".obsidian/plugins/obsidian-ai/",
		]);

		adapter.list.mockImplementation(async (path: string) => {
			if (path === ".obsidian/plugins/obsidian-ai/") {
				return {
					files: [
						".obsidian/plugins/obsidian-ai/data.json",
						".obsidian/plugins/obsidian-ai/main.js",
						".obsidian/plugins/obsidian-ai/manifest.json",
					],
					folders: [".obsidian/plugins/obsidian-ai/sessions/"],
				};
			}
			if (path === ".obsidian/plugins/obsidian-ai/sessions/") {
				return {
					files: [
						".obsidian/plugins/obsidian-ai/sessions/session-001.json",
					],
					folders: [],
				};
			}
			return { files: [], folders: [] };
		});
		adapter.stat.mockResolvedValue({ type: "file", mtime: 1, size: 1 });

		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		const files = await scanner.scan();
		warnSpy.mockRestore();

		const paths = files.map((f) => f.path);
		// Blocked files directly in plugin root
		expect(paths).not.toContain(".obsidian/plugins/obsidian-ai/data.json");
		expect(paths).not.toContain(".obsidian/plugins/obsidian-ai/main.js");
		expect(paths).not.toContain(".obsidian/plugins/obsidian-ai/manifest.json");
		// Allowed session file in subdirectory
		expect(paths).toContain(".obsidian/plugins/obsidian-ai/sessions/session-001.json");
		expect(files).toHaveLength(1);
	});

	it("rejects path traversal ../outside", async () => {
		const { scanner } = createHiddenScanner(["../outside/"]);

		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		const files = await scanner.scan();
		warnSpy.mockRestore();

		expect(files).toHaveLength(0);
	});

	it("empty includes results in no hidden scanning", async () => {
		const { scanner } = createHiddenScanner([]);

		const files = await scanner.scan();
		expect(files).toHaveLength(0);
	});

	it("logs blocked paths at warn level", async () => {
		const { scanner, adapter } = createHiddenScanner([
			".obsidian/plugins/obsidian-ai/sessions/",
		]);

		adapter.list.mockResolvedValue({
			files: [
				".obsidian/plugins/obsidian-ai/sessions/session-001.json",
				".obsidian/plugins/obsidian-ai/sessions/data.json",
				".obsidian/plugins/obsidian-ai/sessions/main.js",
			],
			folders: [],
		});
		adapter.stat.mockResolvedValue({ type: "file", mtime: 1, size: 1 });

		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		await scanner.scan();

		const blockWarnings = warnSpy.mock.calls.filter(
			(call) =>
				typeof call[0] === "string" && call[0].includes("Blocked hidden path:")
		);
		warnSpy.mockRestore();

		expect(blockWarnings).toHaveLength(2);
		expect(blockWarnings[0][0]).toContain("data.json");
		expect(blockWarnings[1][0]).toContain("main.js");
	});

	it("handles mixed valid and blocked paths in realistic obsidian-ai structure", async () => {
		const { scanner, adapter } = createHiddenScanner([
			".obsidian/plugins/obsidian-ai/sessions/",
			".obsidian/plugins/other-plugin/",
		]);

		adapter.list.mockImplementation(async (path: string) => {
			if (path === ".obsidian/plugins/obsidian-ai/sessions/") {
				return {
					files: [
						".obsidian/plugins/obsidian-ai/sessions/session-001.json",
						".obsidian/plugins/obsidian-ai/sessions/session-002.json",
					],
					folders: [],
				};
			}
			if (path === ".obsidian/plugins/other-plugin/") {
				return {
					files: [
						".obsidian/plugins/other-plugin/main.js",
						".obsidian/plugins/other-plugin/data.json",
						".obsidian/plugins/other-plugin/manifest.json",
					],
					folders: [],
				};
			}
			return { files: [], folders: [] };
		});
		adapter.stat.mockResolvedValue({ type: "file", mtime: 1, size: 1 });

		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		const files = await scanner.scan();
		warnSpy.mockRestore();

		const paths = files.map((f) => f.path);
		// obsidian-ai session files are allowed
		expect(paths).toContain(".obsidian/plugins/obsidian-ai/sessions/session-001.json");
		expect(paths).toContain(".obsidian/plugins/obsidian-ai/sessions/session-002.json");
		// other-plugin files are all directly in plugin root → blocked
		expect(paths).not.toContain(".obsidian/plugins/other-plugin/main.js");
		expect(paths).not.toContain(".obsidian/plugins/other-plugin/data.json");
		expect(paths).not.toContain(".obsidian/plugins/other-plugin/manifest.json");
		expect(files).toHaveLength(2);
	});
});
