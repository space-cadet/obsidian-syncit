import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => ({
	TFile: class MockTFile {},
}));

import { VaultScanner } from "../src/local/VaultScanner";
import type { SyncItSettings } from "../src/types";

const settings = {
	excludePatterns: [],
	moveToTrash: false,
} as SyncItSettings;

function createScanner() {
	const adapter = {
		exists: vi.fn().mockResolvedValue(false),
		mkdir: vi.fn().mockResolvedValue(undefined),
		write: vi.fn().mockResolvedValue(undefined),
		rename: vi.fn().mockResolvedValue(undefined),
		remove: vi.fn().mockResolvedValue(undefined),
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

describe("VaultScanner atomic writes", () => {
	it("writes beside the target and renames after the temporary write succeeds", async () => {
		const { scanner, adapter } = createScanner();

		await scanner.writeFile("notes/chinese.md", "new content");

		expect(adapter.mkdir).toHaveBeenCalledWith("notes");
		expect(adapter.write).toHaveBeenCalledWith(
			expect.stringMatching(/^notes\/\.syncit-tmp-chinese\.md-/),
			"new content",
		);
		const tempPath = adapter.write.mock.calls[0][0];
		expect(adapter.rename).toHaveBeenCalledWith(tempPath, "notes/chinese.md");
		expect(adapter.remove).not.toHaveBeenCalled();
	});

	it("cleans up when writing the temporary file fails", async () => {
		const { scanner, adapter } = createScanner();
		const error = new Error("disk full");
		adapter.write.mockRejectedValueOnce(error);

		await expect(scanner.writeFile("note.md", "content")).rejects.toBe(error);

		const tempPath = adapter.write.mock.calls[0][0];
		expect(adapter.remove).toHaveBeenCalledWith(tempPath);
		expect(adapter.rename).not.toHaveBeenCalled();
	});

	it("cleans up when replacing the final path fails", async () => {
		const { scanner, adapter } = createScanner();
		const error = new Error("rename failed");
		adapter.rename.mockRejectedValueOnce(error);

		await expect(scanner.writeFile("note.md", "content")).rejects.toBe(error);

		const tempPath = adapter.write.mock.calls[0][0];
		expect(adapter.remove).toHaveBeenCalledWith(tempPath);
	});

	it("ignores and can remove orphaned temporary files", async () => {
		const { scanner, adapter, vault } = createScanner();
		vault.getFiles.mockReturnValue([
			{ path: ".syncit-tmp-note.md-old" },
			{ path: "note.md", stat: { mtime: 1, size: 1 } },
		]);

		expect(await scanner.scan()).toHaveLength(1);
		expect(await scanner.cleanupTempFiles()).toBe(1);
		expect(adapter.remove).toHaveBeenCalledWith(".syncit-tmp-note.md-old");
	});
});
