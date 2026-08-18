import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => ({ requestUrl: vi.fn() }));

import { SyncPlanBuilder } from "../src/sync/SyncPlan";
import type { FileEntity, SyncIndex } from "../src/types";
import type { VaultScanner } from "../src/local/VaultScanner";
import type { WebDAVAdapter } from "../src/remote/WebDAVAdapter";

const file = (path: string, mtime = 1, size = 1): FileEntity => ({
	path,
	mtime,
	size,
});

function builder(index: SyncIndex | null = null) {
	return new SyncPlanBuilder(
		{} as VaultScanner,
		{} as WebDAVAdapter,
		undefined,
		index,
	);
}

describe("SyncPlanBuilder first-sync safety gate", () => {
	it("does not upload or download unmatched files without a baseline", () => {
		const plan = builder().buildPlan(
			[file("stale-local.md")],
			[file("remote-only.md")],
		);

		expect(plan.requiresReconciliation).toBe(true);
		expect(plan.reconciliation).toHaveLength(2);
		expect(plan.uploads).toHaveLength(0);
		expect(plan.downloads).toHaveLength(0);
	});

	it("does not silently overwrite a same-path conflict without a baseline", () => {
		const plan = builder().buildPlan(
			[file("note.md", 20, 10)],
			[file("note.md", 10, 20)],
		);

		expect(plan.requiresReconciliation).toBe(true);
		expect(plan.reconciliation[0]?.reason).toBe("no-baseline-conflict");
		expect(plan.uploads).toHaveLength(0);
		expect(plan.downloads).toHaveLength(0);
		expect(plan.conflicts).toHaveLength(0);
	});

	it("turns a previously indexed missing remote file into a reconciliation item", () => {
		const plan = builder({
			lastSyncTime: 10,
			serverSignature: "server",
			files: {
				"deleted-remotely.md": {
					localMtime: 1,
					localSize: 1,
					remoteMtime: 1,
					remoteSize: 1,
					etag: "etag",
				},
			},
		}).buildPlan([file("deleted-remotely.md")], []);

		expect(plan.requiresReconciliation).toBe(true);
		expect(plan.reconciliation[0]?.reason).toBe("possible-remote-deletion");
		expect(plan.uploads).toHaveLength(0);
	});
});
