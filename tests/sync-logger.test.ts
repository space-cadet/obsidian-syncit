import { describe, expect, it } from "vitest";
import { SyncLogger } from "../src/logging/SyncLogger";

function memoryStorage(initial: Record<string, string> = {}) {
	const files = new Map(Object.entries(initial));
	return {
		files,
		exists: async (path: string) => files.has(path),
		read: async (path: string) => files.get(path) ?? "",
		write: async (path: string, data: string) => { files.set(path, data); },
		remove: async (path: string) => { files.delete(path); },
	};
}

function logger(storage: ReturnType<typeof memoryStorage>, overrides: Partial<ConstructorParameters<typeof SyncLogger>[0]> = {}) {
	return new SyncLogger({
		pluginDirPath: ".obsidian/plugins/obsidian-syncit",
		storage,
		minLevel: "DEBUG",
		maxAgeDays: 30,
		maxSizeMB: 10,
		keepBackup: false,
		...overrides,
	});
}

describe("SyncLogger", () => {
	it("writes sanitized structured entries and returns bounded newest-first pages", async () => {
		const storage = memoryStorage();
		const log = logger(storage);
		await log.info("sync", "Started", { sessionId: "run-1", authorization: "Bearer top-secret" });
		await log.error("sync-operation", "Upload failed: https://user:pass@example.test — token=abc", {
			sessionId: "run-1",
			path: "note.md",
		});
		await log.warn("sync", "Warning", { sessionId: "run-2" });
		await log.flush();

		const raw = storage.files.get(".syncit/log.jsonl") ?? "";
		expect(raw).not.toContain("top-secret");
		expect(raw).not.toContain("user:pass");
		expect(raw).not.toContain("abc");

		const first = await log.readPage({ limit: 2 });
		expect(first.entries).toHaveLength(2);
		expect(first.entries[0]?.level).toBe("WARNING");
		expect(first.nextCursor).not.toBeNull();
		expect(first.counts.ERROR).toBe(1);
		expect(first.matchingEntries).toBe(3);

		const older = await log.readPage({ limit: 2, cursor: first.nextCursor ?? undefined });
		expect(older.entries).toHaveLength(1);
		expect(older.entries[0]?.level).toBe("INFO");
		const errors = await log.readEntries({ level: "ERROR" });
		expect(errors[0]?.details?.path).toBe("note.md");
	});

	it("supports search, category, session, and time filters", async () => {
		const now = new Date();
		const old = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString();
		const storage = memoryStorage({
			".syncit/log.jsonl": [
				JSON.stringify({ timestamp: old, level: "INFO", category: "sync", message: "old", details: { sessionId: "old" } }),
				JSON.stringify({ timestamp: now.toISOString(), level: "ERROR", category: "sync-operation", message: "failed note", details: { sessionId: "new", path: "note.md" } }),
			].join("\n") + "\n",
		});
		const page = await logger(storage).readPage({ search: "note.md", category: "sync-operation", session: "new", from: new Date(now.getTime() - 60_000).toISOString() });
		expect(page.entries).toHaveLength(1);
		expect(page.entries[0]?.level).toBe("ERROR");
	});

	it("purges old and malformed lines and trims oversized logs to the retention target", async () => {
		const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
		const storage = memoryStorage({
			".syncit/log.jsonl": [
				"not json",
				JSON.stringify({ timestamp: old, level: "INFO", category: "sync", message: "old" }),
				JSON.stringify({ timestamp: new Date().toISOString(), level: "INFO", category: "sync", message: "keep" }),
			].join("\n") + "\n",
		});
		const log = logger(storage, { maxAgeDays: 30, maxSizeMB: 0.001 });
		await log.info("sync", "x".repeat(1800));
		await log.flush();

		const content = storage.files.get(".syncit/log.jsonl") ?? "";
		expect(new Blob([content]).size).toBeLessThanOrEqual(0.001 * 1024 * 1024);
		expect(content).not.toContain("not json");
		expect(content).not.toContain('"message":"old"');
	});

	it("applies max-size and backup changes at runtime", async () => {
		const storage = memoryStorage();
		const log = logger(storage);
		await log.info("sync", "before backup " + "x".repeat(1400));
		await log.flush();
		await log.updateSettings({ maxSizeMB: 0.001 });
		const trimmed = storage.files.get(".syncit/log.jsonl") ?? "";
		expect(new Blob([trimmed]).size).toBeLessThanOrEqual(0.001 * 1024 * 1024);
		await log.updateSettings({ keepBackup: true });
		expect(storage.files.has(".obsidian/plugins/obsidian-syncit/sync-log.jsonl")).toBe(true);
		await log.updateSettings({ keepBackup: false });
		expect(storage.files.has(".obsidian/plugins/obsidian-syncit/sync-log.jsonl")).toBe(false);
		await log.info("sync", "after backup");
		await log.flush();
		expect(storage.files.get(".syncit/log.jsonl")).toContain("after backup");
	});
});
