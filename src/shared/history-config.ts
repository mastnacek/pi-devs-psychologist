/**
 * history-config — the settings for the opt-in cross-session record (T10).
 *
 * Split out of `config.ts` (which is at its line budget) so the ONE feature that keeps something
 * across sessions also keeps its own switch, plainly readable. All three keys normalise key by key,
 * so a junk value falls back to the safe default rather than taking the others down with it.
 */

/** Default days a line is kept before a read skips it and the next append rewrites it away. */
export const DEFAULT_HISTORY_RETENTION_DAYS = 90;

export interface HistoryConfig {
	/**
	 * OFF BY DEFAULT, and that is the point: this is the only feature that stores anything that
	 * outlives a session. `true` is the only value that turns it on, so a missing or nonsense key
	 * never starts writing.
	 */
	enabled: boolean;
	/** Lines older than this (by `at`) are dropped on read and removed by the next append. */
	retentionDays: number;
	/** Override for the JSONL path. Empty means `<cwd>/.pi/psych-history/history.jsonl`. */
	path: string;
}

export const DEFAULT_HISTORY_CONFIG: HistoryConfig = {
	enabled: false,
	retentionDays: DEFAULT_HISTORY_RETENTION_DAYS,
	path: "",
};

/** Whole number at or above `min`, or the fallback when unusable. Mirrors `config.ts`. */
function positiveInt(value: unknown, fallback: number, min: number): number {
	const parsed = Number(value);
	return Number.isFinite(parsed) && parsed >= min ? Math.floor(parsed) : fallback;
}

/** Coerce a persisted `history` layer into a usable config; junk becomes the default. */
export function normalizeHistory(value: unknown): HistoryConfig {
	const raw = value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
	return {
		enabled: raw.enabled === true,
		retentionDays: positiveInt(raw.retentionDays, DEFAULT_HISTORY_CONFIG.retentionDays, 1),
		path: typeof raw.path === "string" ? raw.path.trim() : "",
	};
}
