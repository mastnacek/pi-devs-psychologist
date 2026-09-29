/**
 * history-store — the opt-in cross-session delivery record (T10): ONE JSONL file per project.
 *
 * THE PROMISE, and it is a promise about data. This is the only module in the plugin that keeps
 * anything that outlives a session, so its contents are the promise: delivery events and session
 * COUNTS, and nothing else. Never a prompt, never a message body, never a file path, never a tool
 * name, never a model name, never a score, never a rate, never a trend framed as a number about the
 * operator. Two line kinds and no others, and every key of each is pinned by the exact-key-set test
 * in `test/history-record.test.js`:
 *
 *   session  { at, turns, toolCalls, failures, verifiedRuns, unverifiedMutations }
 *   delivery { at, kind, verdict, followed }   verdict ∈ improved|unchanged|worse|unresolved
 *
 * There is deliberately NO session identifier. It would be the one field joining this record to a
 * session file full of prompts, and nothing here reads it back: "sessions recorded" is a count of
 * `session` lines and the split is a count of `delivery` lines. If a future field would let this
 * file be read about a person rather than about a session, drop it rather than soften it.
 *
 * Pure storage: no engine imports. Reads never create the file or its directory (the directory is
 * created on the FIRST append). Retention is applied on read — lines older than `retentionDays` are
 * skipped, and the file is rewritten without them at the next append.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { MetricVerdicts } from "./outcome.js";
import { DEFAULT_HISTORY_RETENTION_DAYS } from "./history-config.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Where the record lives under the project, when `history.path` is empty. Namespaced by owner. */
export const HISTORY_DIR = "psych-history";
export const HISTORY_FILE = "history.jsonl";

/** The JSONL path for a project: the `history.path` override, else the namespaced default. */
export function historyFilePath(cwd: string, override: string): string {
	const trimmed = override.trim();
	return trimmed.length > 0 ? trimmed : join(cwd, ".pi", HISTORY_DIR, HISTORY_FILE);
}

/** The four outcomes one delivered intervention can be recorded with (T10). */
export type DeliveryVerdict = "improved" | "unchanged" | "worse" | "unresolved";
export const DELIVERY_VERDICTS: readonly DeliveryVerdict[] = ["improved", "unchanged", "worse", "unresolved"];

/** One session's counts. No identifier, no score, no mood. */
export interface SessionLine {
	at: number;
	turns: number;
	toolCalls: number;
	failures: number;
	verifiedRuns: number;
	unverifiedMutations: number;
}

/** One delivered intervention's outcome. `kind` is the intervention kind, not a line type. */
export interface DeliveryLine {
	at: number;
	kind: string;
	verdict: DeliveryVerdict;
	followed: boolean;
}

export type HistoryLine = SessionLine | DeliveryLine;

/** The exact key sets, sorted, that a line of each kind must have and no more. */
const SESSION_KEYS = ["at", "failures", "toolCalls", "turns", "unverifiedMutations", "verifiedRuns"];
const DELIVERY_KEYS = ["at", "followed", "kind", "verdict"];

function hasExactKeys(record: Record<string, unknown>, expected: readonly string[]): boolean {
	const keys = Object.keys(record).sort();
	return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

/**
 * Validate one parsed object into a line, or `undefined` when its key set is not one of the two.
 *
 * This is the enforcement of "two line kinds and no others": a line with a missing, extra or
 * misspelled key is not repaired, it is dropped. A delivery is told apart from a session by its
 * `kind` key — the session line has none, by design.
 */
export function asHistoryLine(value: unknown): HistoryLine | undefined {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
	const record = value as Record<string, unknown>;
	if (!isFiniteNumber(record.at)) return undefined;
	if (hasExactKeys(record, DELIVERY_KEYS)) {
		if (typeof record.kind !== "string") return undefined;
		if (typeof record.followed !== "boolean") return undefined;
		if (!DELIVERY_VERDICTS.includes(record.verdict as DeliveryVerdict)) return undefined;
		return { at: record.at, kind: record.kind, verdict: record.verdict as DeliveryVerdict, followed: record.followed };
	}
	if (hasExactKeys(record, SESSION_KEYS)) {
		const numbers = [record.turns, record.toolCalls, record.failures, record.verifiedRuns, record.unverifiedMutations];
		if (!numbers.every(isFiniteNumber)) return undefined;
		return {
			at: record.at,
			turns: record.turns as number,
			toolCalls: record.toolCalls as number,
			failures: record.failures as number,
			verifiedRuns: record.verifiedRuns as number,
			unverifiedMutations: record.unverifiedMutations as number,
		};
	}
	return undefined;
}

/** Filesystem seam, injectable so the store is testable without touching a real file. */
export interface HistoryIo {
	exists(path: string): boolean;
	read(path: string): string;
	write(path: string, text: string): void;
	mkdirp(dir: string): void;
}

const defaultIo: HistoryIo = {
	exists: (path) => existsSync(path),
	read: (path) => readFileSync(path, "utf8"),
	write: (path, text) => writeFileSync(path, text, "utf8"),
	mkdirp: (dir) => mkdirSync(dir, { recursive: true }),
};

export interface ReadHistoryOptions {
	retentionDays?: number;
	now?: number;
	io?: HistoryIo;
}

/**
 * Read the record, applying retention. NEVER creates the file or the directory.
 *
 * `dropped` counts every line that was not returned: unparsable, key-mismatched, or older than the
 * retention window. It lets the report say "everything was dropped" instead of showing an empty
 * table that looks like "nothing happened".
 */
export function readHistory(
	path: string,
	options: ReadHistoryOptions = {},
): { lines: HistoryLine[]; dropped: number } {
	const retentionDays = options.retentionDays ?? DEFAULT_HISTORY_RETENTION_DAYS;
	const now = options.now ?? Date.now();
	const io = options.io ?? defaultIo;
	const lines: HistoryLine[] = [];
	let dropped = 0;
	if (!io.exists(path)) return { lines, dropped };
	let text: string;
	try {
		text = io.read(path);
	} catch {
		return { lines, dropped };
	}
	const cutoff = now - retentionDays * DAY_MS;
	for (const raw of text.split("\n")) {
		if (raw.length === 0) continue;
		let parsed: unknown;
		try {
			parsed = JSON.parse(raw);
		} catch {
			dropped += 1;
			continue;
		}
		const line = asHistoryLine(parsed);
		if (line === undefined || line.at < cutoff) {
			dropped += 1;
			continue;
		}
		lines.push(line);
	}
	return { lines, dropped };
}

export interface AppendHistoryOptions {
	retentionDays?: number;
	now?: number;
	io?: HistoryIo;
}

/**
 * Append lines, creating the directory on the first write; expired lines are pruned in the same
 * rewrite. Serialises valid existing lines plus the new ones, so the file never accumulates a line
 * a read would only drop.
 */
export function appendHistory(
	path: string,
	lines: readonly HistoryLine[],
	options: AppendHistoryOptions = {},
): number {
	const retentionDays = options.retentionDays ?? DEFAULT_HISTORY_RETENTION_DAYS;
	const now = options.now ?? Date.now();
	const io = options.io ?? defaultIo;
	const kept = readHistory(path, { retentionDays, now, io }).lines;
	const text = [...kept, ...lines].map((line) => JSON.stringify(line)).join("\n");
	io.mkdirp(dirname(path));
	io.write(path, text.length > 0 ? `${text}\n` : "");
	return lines.length;
}

/** One kind's four-way verdict tally. No delivery count beyond the verdicts themselves. */
export interface KindTally {
	kind: string;
	improved: number;
	unchanged: number;
	worse: number;
	unresolved: number;
}

/** The whole record folded: how many sessions, when, and the per-kind split. */
export interface HistorySummary {
	sessions: number;
	deliveries: number;
	firstAt: number | undefined;
	lastAt: number | undefined;
	byKind: KindTally[];
}

/** Fold the read lines into the report's numbers. Pure. */
export function summarizeHistory(lines: readonly HistoryLine[]): HistorySummary {
	let sessions = 0;
	let deliveries = 0;
	let firstAt: number | undefined;
	let lastAt: number | undefined;
	const byKind = new Map<string, KindTally>();
	for (const line of lines) {
		firstAt = firstAt === undefined ? line.at : Math.min(firstAt, line.at);
		lastAt = lastAt === undefined ? line.at : Math.max(lastAt, line.at);
		if ("kind" in line) {
			deliveries += 1;
			const tally = byKind.get(line.kind) ?? { kind: line.kind, improved: 0, unchanged: 0, worse: 0, unresolved: 0 };
			tally[line.verdict] += 1;
			byKind.set(line.kind, tally);
		} else {
			sessions += 1;
		}
	}
	return {
		sessions,
		deliveries,
		firstAt,
		lastAt,
		byKind: [...byKind.values()].sort((a, b) => a.kind.localeCompare(b.kind)),
	};
}

/**
 * Collapse one session's per-metric verdicts into the single verdict this record stores.
 *
 * `unresolved` when the outcome window never closed. Otherwise a plain majority of the four metrics
 * (improved vs worse, ties are `unchanged`) — the documented rule, not a score: it says whether the
 * technique moved the session's counters, and it is never a number about the operator.
 */
export function deliveryVerdict(record: { verdicts?: MetricVerdicts }): DeliveryVerdict {
	if (record.verdicts === undefined) return "unresolved";
	const values = Object.values(record.verdicts);
	const improved = values.filter((verdict) => verdict === "improved").length;
	const worse = values.filter((verdict) => verdict === "worse").length;
	if (improved > worse) return "improved";
	if (worse > improved) return "worse";
	return "unchanged";
}
