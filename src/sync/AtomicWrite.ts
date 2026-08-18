/** Marker used for temporary files created during atomic writes. */
export const SYNCIT_TEMP_MARKER = ".syncit-tmp-";

let tempCounter = 0;

/** Return true when a path is a SyncIt temporary file. */
export function isSyncitTempPath(path: string): boolean {
	const name = path.split("/").pop() ?? "";
	return name.startsWith(SYNCIT_TEMP_MARKER);
}

/** Create a temporary path beside the final path. */
export function createSyncitTempPath(path: string): string {
	const separator = path.lastIndexOf("/");
	const directory = separator >= 0 ? path.slice(0, separator + 1) : "";
	const filename = separator >= 0 ? path.slice(separator + 1) : path;
	return `${directory}${SYNCIT_TEMP_MARKER}${filename}-${Date.now()}-${++tempCounter}`;
}
