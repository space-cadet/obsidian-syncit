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
	}

	/**
	 * List all files in the remote vault directory recursively.
	 */
	async listFiles(): Promise<FileEntity[]> {
		const items = await this.propfind(this.baseDir, 1);
		const results: FileEntity[] = [];

		for (const item of items) {
			// Skip the directory itself
			if (item.href.endsWith("/" + this.baseDir) || item.href === "/" + this.baseDir) {
				continue;
			}

			const path = this.hrefToPath(item.href);
			if (!path) continue;

			// Skip directories (they end with /)
			if (path.endsWith("/")) continue;

			results.push({
				path,
				mtime: item.lastModified ? new Date(item.lastModified).getTime() : 0,
				size: item.contentLength || 0,
			});
		}

		return results;
	}

	/**
	 * Read a file from the remote server.
	 */
	async readFile(path: string): Promise<string> {
		const fullPath = this.baseDir + path;
		const res = await this.request("GET", fullPath);
		return res.text;
	}

	/**
	 * Write a file to the remote server.
	 */
	async writeFile(path: string, content: string): Promise<void> {
		const fullPath = this.baseDir + path;
		
		// Ensure parent directories exist
		const parts = path.split("/");
		if (parts.length > 1) {
			let parentPath = "";
			for (let i = 0; i < parts.length - 1; i++) {
				parentPath += parts[i] + "/";
				await this.mkcol(this.baseDir + parentPath);
			}
		}

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
		depth: number,
	): Promise<Array<{ href: string; lastModified?: string; contentLength?: number }>> {
		const xml = `<?xml version="1.0" encoding="utf-8"?>
<D:propfind xmlns:D="DAV:">
  <D:prop>
    <D:getlastmodified/>
    <D:getcontentlength/>
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
	}> {
		const parser = new DOMParser();
		const doc = parser.parseFromString(xml, "application/xml");
		const responses = doc.getElementsByTagNameNS("DAV:", "response");

		const results: Array<{
			href: string;
			lastModified?: string;
			contentLength?: number;
		}> = [];

		for (const response of Array.from(responses)) {
			const href = response.getElementsByTagNameNS("DAV:", "href")[0]?.textContent || "";
			const propstat = response.getElementsByTagNameNS("DAV:", "propstat")[0];
			if (!propstat) continue;
			const prop = propstat.getElementsByTagNameNS("DAV:", "prop")[0];
			if (!prop) continue;

			const lastModified = prop.getElementsByTagNameNS("DAV:", "getlastmodified")[0]?.textContent || undefined;
			const contentLengthStr = prop.getElementsByTagNameNS("DAV:", "getcontentlength")[0]?.textContent;
			const contentLength = contentLengthStr ? parseInt(contentLengthStr, 10) : undefined;

			results.push({ href, lastModified, contentLength });
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
