/**
 * The version of the build that is actually loaded.
 *
 * A report rendered by a stale runtime looks exactly like a report rendered by
 * the code you are reading, and the difference is invisible until someone argues
 * about it. Putting the version in the report header turns "is this the new
 * build?" into a one-glance question.
 *
 * Cross-platform by construction: the path comes from `import.meta.url`, so it
 * resolves identically on Windows (`C:\…`) and POSIX, and no shell, environment
 * variable or `path.join` is involved. A missing or unreadable manifest degrades
 * to `unknown` rather than breaking the report.
 */

import { readFileSync } from "node:fs";
import { engineVersion } from "./environment.js";

function readVersion(): string {
	try {
		// src/shared/ → two levels up is the package root, on every platform.
		const manifest = new URL("../../package.json", import.meta.url);
		const parsed = JSON.parse(readFileSync(manifest, "utf8")) as { version?: unknown };
		return typeof parsed.version === "string" && parsed.version.length > 0
			? parsed.version
			: "unknown";
	} catch {
		return "unknown";
	}
}

/** e.g. `0.0.1` — shown in the report header. */
export const PLUGIN_VERSION: string = readVersion();

/**
 * The running ENGINE version (e.g. `0.87.1`), interpolated into the child's brief so it can name
 * the pi it is observing. Resolved once at load via the engine manifest (T23/T24).
 */
export const PI_VERSION: string = engineVersion();