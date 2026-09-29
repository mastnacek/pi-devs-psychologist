/**
 * handoff-previous — the LAST session's ledger, found without a session in common.
 *
 * A TUI-only session entry lives in ONE session file. `sessionManager.getEntries()` therefore sees
 * it on `/reload` or `--continue`, and never on a new session: the feature's own unit test passed
 * only because its fake handed the same list to both halves. A live run found no handoff at all.
 *
 * So the previous ledger is read from the most recent session file in this project's session
 * directory, excluding the current one. It is read structurally — a `custom` entry with this
 * plugin's type — so nothing else in another session's file is read, and no message body is touched.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { HANDOFF_ENTRY, type HandoffLedger } from "./handoff.js";

/** The `custom` entry shape this needs. Anything else is ignored without being read further. */
interface CustomEntry {
	type?: string;
	customType?: string;
	data?: unknown;
}

/** The newest `.jsonl` session file in `dir` that is not `currentFile`, or `undefined`. */
export function previousSessionFile(
	dir: string,
	currentFile: string | undefined,
	io: { exists: (path: string) => boolean; list: (path: string) => string[]; mtime: (path: string) => number } = {
		exists: existsSync,
		list: (path) => readdirSync(path),
		mtime: (path) => (existsSync(path) ? statSync(path).mtimeMs : 0),
	},
): string | undefined {
	if (!io.exists(dir)) return undefined;
	let best: string | undefined;
	let bestTime = -1;
	let names: string[];
	try {
		names = io.list(dir);
	} catch {
		return undefined;
	}
	for (const name of names) {
		if (!name.endsWith(".jsonl")) continue;
		const full = join(dir, name);
		if (currentFile !== undefined && full === currentFile) continue;
		// The engine's session files are named `<timestamp>_<uuid>.jsonl`; anything else in the
		// directory is not a session and must not be parsed.
		if (!/^\d{4}-\d{2}-\d{2}T[\d-]+Z_[\w-]+\.jsonl$/.test(name)) continue;
		const time = io.mtime(full);
		if (time > bestTime) {
			bestTime = time;
			best = full;
		}
	}
	return best;
}

/** Parse a session file's lines, keeping only this plugin's handoff entries. Pure over a text. */
export function ledgersIn(text: string): HandoffLedger[] {
	const ledgers: HandoffLedger[] = [];
	for (const line of text.split("\n")) {
		if (line.length === 0) continue;
		let entry: unknown;
		try {
			entry = JSON.parse(line);
		} catch {
			continue;
		}
		const custom = entry as CustomEntry;
		if (custom?.type !== "custom" || custom.customType !== HANDOFF_ENTRY) continue;
		const data = custom.data;
		if (data === null || typeof data !== "object") continue;
		ledgers.push(data as HandoffLedger);
	}
	return ledgers;
}

/** The last handoff ledger recorded in a previous session file, or `undefined`. */
export function previousLedger(
	dir: string,
	currentFile: string | undefined,
	io?: { exists: (path: string) => boolean; list: (path: string) => string[]; mtime: (path: string) => number; read: (path: string) => string },
): HandoffLedger | undefined {
	const file = previousSessionFile(dir, currentFile, io);
	if (file === undefined) return undefined;
	const read = io?.read ?? ((path: string) => readFileSync(path, "utf8"));
	let text: string;
	try {
		text = read(file);
	} catch {
		return undefined;
	}
	const ledgers = ledgersIn(text);
	return ledgers.length > 0 ? ledgers[ledgers.length - 1] : undefined;
}

/** The session file's own name, for the exclusion above. */
export function currentSessionFile(dir: string | undefined, getSessionFile: () => string | undefined): string | undefined {
	if (dir === undefined) return undefined;
	const file = getSessionFile();
	return file === undefined ? undefined : basename(file) === file ? file : file;
}
