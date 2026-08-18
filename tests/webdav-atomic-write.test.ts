import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => ({ requestUrl: vi.fn() }));

import { requestUrl } from "obsidian";
import { WebDAVAdapter } from "../src/remote/WebDAVAdapter";

const mockedRequestUrl = vi.mocked(requestUrl);

function createAdapter() {
	const adapter = new WebDAVAdapter() as any;
	adapter.config = {
		url: "https://dav.example/",
		baseDir: "vault",
		username: "user",
		password: "password",
	};
	adapter.baseUrl = "https://dav.example/";
	adapter.baseDir = "vault/";
	adapter.startSession();
	return adapter as WebDAVAdapter;
}

function response(status: number, text = "") {
	return { status, text, headers: {} };
}

describe("WebDAVAdapter atomic writes", () => {
	beforeEach(() => {
		mockedRequestUrl.mockReset();
	});

	it("uploads to a temporary path and moves it over the final path", async () => {
		mockedRequestUrl.mockResolvedValue(response(201) as never);
		const adapter = createAdapter();

		await adapter.writeFile("note.md", "new content");

		const calls = mockedRequestUrl.mock.calls.map(([request]) => request as any);
		expect(calls.map((request) => request.method)).toEqual(["PUT", "MOVE"]);
		expect(calls[0].url).toMatch(/vault\/\.syncit-tmp-note\.md-/);
		expect(calls[0].body).toBe("new content");
		expect(calls[1].url).toMatch(/vault\/\.syncit-tmp-note\.md-/);
		expect(calls[1].headers.Destination).toBe("https://dav.example/vault/note.md");
		expect(calls[1].headers.Overwrite).toBe("T");
	});

	it("deletes the temporary upload when PUT fails", async () => {
		mockedRequestUrl.mockImplementation(async (request: any) =>
			request.method === "PUT" ? response(500, "server rejected") : response(204),
		);
		const adapter = createAdapter();

		await expect(adapter.writeFile("note.md", "content")).rejects.toThrow(/PUT/);

		const calls = mockedRequestUrl.mock.calls.map(([request]) => request as any);
		expect(calls.map((request) => request.method)).toEqual(["PUT", "DELETE"]);
		expect(calls[1].url).toMatch(/vault\/\.syncit-tmp-note\.md-/);
	});

	it("deletes the temporary upload when MOVE fails", async () => {
		mockedRequestUrl.mockImplementation(async (request: any) =>
			request.method === "MOVE" ? response(405, "MOVE unsupported") : response(201),
		);
		const adapter = createAdapter();

		await expect(adapter.writeFile("note.md", "content")).rejects.toThrow(/MOVE/);

		const calls = mockedRequestUrl.mock.calls.map(([request]) => request as any);
		expect(calls.map((request) => request.method)).toEqual(["PUT", "MOVE", "DELETE"]);
		expect(calls[2].url).toMatch(/vault\/\.syncit-tmp-note\.md-/);
	});
});
