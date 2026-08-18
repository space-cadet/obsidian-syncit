import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => ({ requestUrl: vi.fn() }));

import { SyncPlanBuilder } from "../src/sync/SyncPlan";
import type {
	FileEntity,
	ReconciliationDecision,
	SyncIndex,
} from "../src/types";
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
	it("honors upload-only and download-only directions for ordinary changes", () => {
		const local = file("note.md", 20, 20);
		const remote = file("note.md", 10, 10);
		const upload = builder({ lastSyncTime: 1, serverSignature: "s", files: {} }).buildPlan([local], [remote], "upload-only");
		const download = builder({ lastSyncTime: 1, serverSignature: "s", files: {} }).buildPlan([local], [remote], "download-only");

		expect(upload.uploads.map(item => item.path)).toEqual(["note.md"]);
		expect(upload.downloads).toHaveLength(0);
		expect(download.downloads.map(item => item.path)).toEqual(["note.md"]);
		expect(download.uploads).toHaveLength(0);
	});

	it("ignores unmatched files in the disabled direction", () => {
		const upload = builder({ lastSyncTime: 1, serverSignature: "s", files: {} }).buildPlan([], [file("remote.md")], "upload-only");
		const download = builder({ lastSyncTime: 1, serverSignature: "s", files: {} }).buildPlan([file("local.md")], [], "download-only");

		expect(upload.downloads).toHaveLength(0);
		expect(download.uploads).toHaveLength(0);
	});

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

	it("resolves a stale local-only file as a safe local deletion", () => {
		const plan = builder().buildPlan([file("old.md")], []);
		const resolved = builder().applyReconciliationDecisions(
			plan,
			{ "old.md": "use-remote" as ReconciliationDecision },
			"two-way",
		);

		expect(resolved.requiresReconciliation).toBe(false);
		expect(resolved.localDeletes.map(item => item.path)).toEqual(["old.md"]);
		expect(resolved.uploads).toHaveLength(0);
	});

	it("resolves a remote-only file as an explicit remote deletion", () => {
		const plan = builder().buildPlan([], [file("remote-old.md")]);
		const resolved = builder().applyReconciliationDecisions(
			plan,
			{ "remote-old.md": "use-local" as ReconciliationDecision },
			"two-way",
		);

		expect(resolved.requiresReconciliation).toBe(false);
		expect(resolved.remoteDeletes.map(item => item.path)).toEqual(["remote-old.md"]);
	});

	it("keeps both sides of a same-path conflict by creating a remote copy", () => {
		const plan = builder().buildPlan([file("note.md", 20, 10)], [file("note.md", 10, 20)]);
		const resolved = builder().applyReconciliationDecisions(
			plan,
			{ "note.md": "keep-both" as ReconciliationDecision },
			"two-way",
		);

		expect(resolved.requiresReconciliation).toBe(false);
		expect(resolved.uploads[0]?.path).toBe("note.md");
		expect(resolved.uploads[0]?.targetPath).toBe("note (local copy).md");
		expect(resolved.downloads).toHaveLength(0);
	});

	it("supports download-only mode without requiring per-file choices", () => {
		const plan = builder().buildPlan([file("stale.md")], [file("remote.md")]);
		const resolved = builder().applyReconciliationDecisions(plan, {}, "download-only");

		expect(resolved.requiresReconciliation).toBe(false);
		expect(resolved.localDeletes.map(item => item.path)).toEqual(["stale.md"]);
		expect(resolved.downloads.map(item => item.path)).toEqual(["remote.md"]);
	});
});
