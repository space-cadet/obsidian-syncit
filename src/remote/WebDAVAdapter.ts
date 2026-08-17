import { requestUrl } from "obsidian";
import type { WebDAVConfig, FileEntity } from "../types";

/**
 * WebDAV storage adapter using Obsidian's requestUrl.
 * 
 * Adapted from obsidian-ai's WebDAVStorageAdapter, simplified for vault sync.
 * Uses raw WebDAV operations instead of external libraries for maximum compatibility.
 */
export class WebDAVAdapter {
	private config: WebDAVConfig | null = null;
	private baseUrl: string = "";
	private baseDir: string = "";
	private createdDirs = new Set<string>(); // T12c: track created directories per session
	private abortController: AbortController | null = null;

	async initialize(config: WebDAVConfig): Promise<void> {
		this.config = config;
		this.baseDir = (config.baseDir || "obsidian-syncit").replace(/\/$/, "") + "/";

		let url = config.url.trim();
		if (!url.endsWith("/")) {
			url += "/";
		}
		this.baseUrl = url;

		// Verify connection
		await this.propfind("", 0);

		// Ensure base directory exists
		await this.mkcol(this.baseDir);
	}

	async disconnect(): Promise<void> {
		this.config = null;
		this.baseUrl = "";
		this.createdDirs.clear(); // T12c: reset on disconnect
		this.abortController?.abort();
		this.abortController = null;
	}

	/** Set up a new abort controller for this sync session. */
	startSession(): void {
		this.abortController = new AbortController();
	}

	/** Abort any in-flight operations. */
	abort(): void {
		this.abortController?.abort();
	}

	/** Check if the current session has been aborted. */
	isAborted(): boolean {
		return this.abortController?.signal.aborted ?? false;
	}

	/**
	 * List all files in the remote vault directory recursively.
	 *
	 * Tries Depth: infinity first (single request, full tree). If the server
	 * rejects it, falls back to a recursive Depth: 1 walk.
	 */
	async listFiles(): Promise<FileEntity[]> {
		// Try infinity depth first — most servers (Nextcloud, ownCloud, Apache) support it
		try {
			const items = await this.propfind(this.baseDir, "infinity");
			return this.filterFileEntities(items);
		} catch (err: any) {
			// 403 Forbidden, 400 Bad Request, or 501 Not Implemented = infinity not supported
			if (err.status === 403 || err.status === 400 || err.status === 501) {
				console.info("SyncIt: Depth infinity not supported, falling back to recursive PROPFIND");
				return await this.listFilesRecursive();
			}
			throw err;
		}
	}

	/**
	 * Fallback recursive listing using Depth: 1 per directory.
	 */
	private async listFilesRecursive(): Promise<FileEntity[]> {
		const results: FileEntity[] = [];
		const dirsToScan = [this.baseDir];

		while (dirsToScan.length > 0) {
			const dir = dirsToScan.shift()!;
			const items = await this.propfind(dir, 1);

			for (const item of items) {
				// Skip the directory itself
				if (item.href.endsWith("/" + dir) || item.href === "/" + dir) {
					continue;
				}

				const path = this.hrefToPath(item.href);
				if (!path) continue;

				// Check if it's a directory (no content length, or ends with /)
				const isDir = path.endsWith("/") || item.contentLength === undefined;
				if (isDir) {
					// Queue subdirectory for scanning
					dirsToScan.push(this.baseDir + path);
				} else {
					results.push({
						path,
						mtime: item.lastModified ? new Date(item.lastModified).getTime() : 0,
						size: item.contentLength || 0,
						etag: item.etag,
					});
				}
			}
		}

		return results;
	}

	/**
	 * Convert raw PROPFIND results to FileEntity array, filtering out directories.
	 */
	private filterFileEntities(
		items: Array<{ href: string; lastModified?: string; contentLength?: number; etag?: string }>,
	): FileEntity[] {
		const results: FileEntity[] = [];

		for (const item of items) {
			// Skip the directory itself
			if (item.href.endsWith("/" + this.baseDir) || item.href === "/" + this.baseDir) {
				continue;
			}

			const path = this.hrefToPath(item.href);
			if (!path) continue;

			// Skip directories (they end with / or have no content length)
			if (path.endsWith("/")) continue;

			results.push({
				path,
				mtime: item.lastModified ? new Date(item.lastModified).getTime() : 0,
				size: item.contentLength || 0,
				etag: item.etag,
			});
		}

		return results;
	}

	/**
	 * Read a file from the remote server.
	 */
	async readFile(path: string): Promise<string> {
		if (this.isAborted()) throw new SyncCancelledError();
		const fullPath = this.baseDir + path;
		const res = await this.request("GET", fullPath);
		return res.text;
	}

	/**
	 * Write a file to the remote server.
	 *
	 * T12c: Tracks created directories to avoid redundant MKCOL calls.
	 */
	async writeFile(path: string, content: string): Promise<void> {
		if (this.isAborted()) throw new SyncCancelledError();
		const fullPath = this.baseDir + path;

		// Ensure parent directories exist (batched — only create once per session)
		const parts = path.split("/");
		if (parts.length > 1) {
			let parentPath = "";
			for (let i = 0; i < parts.length - 1; i++) {
				parentPath += parts[i] + "/";
				const fullParentPath = this.baseDir + parentPath;
				if (this.isAborted()) throw new SyncCancelledError();
				if (!this.createdDirs.has(fullParentPath)) {
					await this.mkcol(fullParentPath);
					this.createdDirs.add(fullParentPath);
				}
			}
		}

		if (this.isAborted()) throw new SyncCancelledError();
		await this.request("PUT", fullPath, {
			body: content,
			contentType: "text/markdown",
		});
	}

	/**
	 * Delete a file from the remote server.
	 */
	async deleteFile(path: string): Promise<void> {
		const fullPath = this.baseDir + path;
		await this.request("DELETE", fullPath);
	}

	/**
	 * Test the connection to the WebDAV server.
	 */
	async testConnection(): Promise<{ success: boolean; message: string }> {
		try {
			await this.propfind("", 0);
			return { success: true, message: "Connected successfully" };
		} catch (error) {
			return {
				success: false,
				message: error instanceof Error ? error.message : "Connection failed",
			};
		}
	}

	// ─── Internal WebDAV operations ───

	private getAuthHeader(): string {
		if (!this.config) {
			throw new Error("WebDAV adapter not initialized");
		}
		const encoder = new TextEncoder();
		const bytes = encoder.encode(this.config.username + ":" + this.config.password);
		const base64 = Array.from(bytes)
			.map((b) => String.fromCharCode(b))
			.join("");
		return "Basic " + btoa(base64);
	}

	private async request(
		method: string,
		path: string,
		options: {
			body?: string;
			contentType?: string;
			headers?: Record<string, string>;
		} = {},
	): Promise<{ status: number; text: string; headers: Record<string, string> }> {
		if (!this.config) {
			throw new Error("WebDAV adapter not initialized");
		}

		const url = this.baseUrl + path;
		const headers: Record<string, string> = {
			Authorization: this.getAuthHeader(),
			...(options.contentType ? { "Content-Type": options.contentType } : {}),
			...options.headers,
		};

		try {
			const res = await requestUrl({
				url,
				method,
				headers,
				body: options.body,
				throw: false,
			});

			const responseHeaders: Record<string, string> = {};
			if (res.headers) {
				for (const [key, value] of Object.entries(res.headers)) {
					responseHeaders[key] = String(value);
				}
			}

			if (res.status >= 400) {
				const err = new Error(
					`WebDAV ${method} failed: ${res.status} — ${res.text.slice(0, 200)}`,
				) as Error & { status: number };
				err.status = res.status;
				throw err;
			}

			return { status: res.status, text: res.text, headers: responseHeaders };
		} catch (err: any) {
			if (!err.status) {
				const wrapped = new Error(
					`WebDAV ${method} network error: ${err.message}`,
				) as Error & { status: number };
				wrapped.status = 0;
				throw wrapped;
			}
			throw err;
		}
	}

	private async mkcol(path: string): Promise<void> {
		try {
			await this.request("MKCOL", path);
		} catch (err: any) {
			// 405 = directory already exists
			if (err.status === 405) return;
			
			// 409 = parent doesn't exist, try recursively
			if (err.status === 409) {
				const parent = path.replace(/\/$/, "").split("/").slice(0, -1).join("/") + "/";
				if (parent && parent !== "/" && parent !== path) {
					await this.mkcol(parent);
					await this.request("MKCOL", path);
					return;
				}
			}
			throw err;
		}
	}

	private async propfind(
		path: string,
		depth: number | "infinity",
	): Promise<Array<{ href: string; lastModified?: string; contentLength?: number; etag?: string }>> {
		const xml = `<?xml version="1.0" encoding="utf-8"?>
<D:propfind xmlns:D="DAV:">
  <D:prop>
    <D:getlastmodified/>
    <D:getcontentlength/>
    <D:getetag/>
  </D:prop>
</D:propfind>`;

		const res = await this.request("PROPFIND", path, {
			body: xml,
			contentType: "application/xml; charset=utf-8",
			headers: { Depth: String(depth) },
		});

		return this.parsePropfind(res.text);
	}

	private parsePropfind(xml: string): Array<{
		href: string;
		lastModified?: string;
		contentLength?: number;
		etag?: string;
	}> {
		const parser = new DOMParser();
		const doc = parser.parseFromString(xml, "application/xml");
		const responses = doc.getElementsByTagNameNS("DAV:", "response");

		const results: Array<{
			href: string;
			lastModified?: string;
			contentLength?: number;
			etag?: string;
		}> = [];

		for (const response of Array.from(responses)) {
			const href = response.getElementsByTagNameNS("DAV:", "href")[0]?.textContent || "";
			const propstat = response.getElementsByTagNameNS("DAV:", "propstat")[0];
			if (!propstat) continue;
			const prop = propstat.getElementsByTagNameNS("DAV:", "prop")[0];
			if (!prop) continue;

			const lastModified = prop.getElementsByTagNameNS("DAV:", "getlastmodified")[0]?.textContent || undefined;
			const contentLengthStr = prop.getElementsByTagNameNS("DAV:", "getcontentlength")[0]?.textContent;
			const etag = prop.getElementsByTagNameNS("DAV:", "getetag")[0]?.textContent || undefined;
			const contentLength = contentLengthStr ? parseInt(contentLengthStr, 10) : undefined;

			results.push({ href, lastModified, contentLength, etag });
		}

		return results;
	}

	private hrefToPath(href: string): string | null {
		// Convert absolute href to relative path within baseDir
		const prefix = "/" + this.baseDir;
		if (!href.startsWith(prefix)) {
			// Try without leading slash
			const prefixNoSlash = this.baseDir;
			if (href.startsWith(prefixNoSlash)) {
				return decodeURIComponent(href.slice(prefixNoSlash.length));
			}
			return null;
		}
		return decodeURIComponent(href.slice(prefix.length));
	}
}


/** Thrown when the user cancels an in-progress sync. */
export class SyncCancelledError extends Error {
	constructor() {
		super("Sync cancelled by user");
		this.name = "SyncCancelledError";
	}
}
