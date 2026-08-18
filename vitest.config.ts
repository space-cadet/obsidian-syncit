import { defineConfig } from "vitest/config";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
	resolve: {
		alias: {
			// Obsidian is an external runtime module and does not expose a Node
			// entry point. Tests provide the small surface they need instead.
			obsidian: fileURLToPath(new URL("./tests/mocks/obsidian.ts", import.meta.url)),
		},
	},
});
