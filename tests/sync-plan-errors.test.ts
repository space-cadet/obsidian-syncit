import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => ({ requestUrl: vi.fn() }));

import { SyncPlanBuilder } from "../src/sync/SyncPlan";
import { SyncCancelledError } from "../src/remote/WebDAVAdapter";
import type { FileEntity, SyncPlan } from "../src/types";

const file = (path: string, mtime = 2, size = 10): FileEntity => ({ path, mtime, size });

function operationPlan(): SyncPlan {
	return {
		uploads: [file("upload.md")],
		downloads: [file("download.md")],
		localDeletes: [file("local-delete.md")],
		remoteDeletes: [file("remote-delete.md")],
		conflicts: [{ local: file("conflict.md", 2), remote: file("conflict.md", 1) }],
		reconciliation: [],
		requiresReconciliation: false,
		unchanged: 0,
		uploadSize: 10,
		downloadSize: 10,
	};
}

describe("SyncPlanBuilder operation failures", () => {
	it("returns one structured failure and error progress event for every failed operation", async () => {
		const scanner = {
			readFile: vi.fn().mockRejectedValue(new Error("Authorization: Bearer secret-token")),
			writeFile: vi.fn().mockRejectedValue(new Error("disk full")),
			deleteFile: vi.fn().mockRejectedValue(new Error("permission denied")),
		};
		const adapter = {
			isAborted: vi.fn().mockReturnValue(false),
			writeFile: vi.fn().mockRejectedValue(new Error("https://user:pass@example.test refused")),
			readFile: vi.fn().mockRejectedValue(new Error("remote unavailable")),
			deleteFile: vi.fn().mockRejectedValue(new Error("remote permission denied")),
		};
		const progress: string[] = [];
		const builder = new SyncPlanBuilder(scanner as never, adapter as never);
		const result = await builder.executePlan(operationPlan(), 1, (_current, _total, operation) => progress.push(operation));

		const failures = result.failures ?? [];
		expect(failures).toHaveLength(5);
		expect(result.errors).toHaveLength(5);
		expect(failures.map((failure) => failure.operation)).toEqual([
			"upload", "download", "conflict", "local-delete", "remote-delete",
		]);
		expect(progress).toEqual([
			"error:upload", "error:download", "error:conflict", "error:local-delete", "error:remote-delete",
		]);
		expect(failures.map((failure) => failure.message).join(" ")).not.toContain("secret-token");
		expect(failures.map((failure) => failure.message).join(" ")).not.toContain("user:pass");
	});

	it("does not turn cancellation into a per-file failure", async () => {
		const scanner = { readFile: vi.fn() };
		const adapter = { isAborted: vi.fn().mockReturnValue(true) };
		const builder = new SyncPlanBuilder(scanner as never, adapter as never);
		await expect(builder.executePlan(operationPlan(), 1)).rejects.toBeInstanceOf(SyncCancelledError);
	});
});
