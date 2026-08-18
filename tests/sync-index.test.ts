import { describe, expect, it } from "vitest";
import { SyncIndexManager } from "../src/sync/SyncIndex";
import type { SyncIndex } from "../src/types";

function createStorage() {
	const files = new Map<string, string>();
	return {
		storage: {
			exists: async (path: string) => files.has(path),
			read: async (path: string) => files.get(path) ?? "",
			write: async (path: string, data: string) => void files.set(path, data),
			remove: async (path: string) => void files.delete(path),
		},
		files,
	};
}

function emptyIndex(serverSignature: string): SyncIndex {
	return {
		lastSyncTime: 1,
		serverSignature,
		files: {},
	};
}

describe("SyncIndexManager", () => {
	it("does not reuse an in-memory index for another server signature", async () => {
		const { storage } = createStorage();
		const manager = new SyncIndexManager("plugin", storage);

		await manager.save(emptyIndex("server-a"));

		expect(await manager.load("server-b")).toBeNull();
		expect(await manager.load("server-a")).not.toBeNull();
	});
});
