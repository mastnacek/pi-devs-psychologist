/**
 * child-limits — the budget the child pi reads for itself (T22).
 *
 * The runner (T24) writes three environment values before it spawns the child; this module is the
 * child-side, pure reader of them. It is deliberately NOT the same normaliser as `agent-config.ts`,
 * because the two directions have opposite failure modes: the parent coerces an operator's config
 * file for a human (junk → the documented default, capabilities default ON), while the child reads a
 * machine-set limit and must fail CLOSED. A child that guesses a capability on because it could not
 * read the parent's decision is a child without a guard. So here a missing, malformed or non-boolean
 * key means "off", and the fallback budget is small.
 *
 * `PI_DEVS_PSYCH_RUN` is not read here: the run id names the parent's temp directory, and nothing in
 * the child needs it (T24 owns it).
 */

/** The four roles the runner may spawn (T23 psychologist, T30 ask, T31 scout, T32 pair). */
export const CHILD_ROLES = ["psychologist", "pair", "scout", "ask"] as const;
export type ChildRole = (typeof CHILD_ROLES)[number];

export interface ChildLimits {
	/** How many tool calls the child may make before only `psych_submit` is left. */
	maxToolCalls: number;
	/** The `web_search` / `fetch_content` / `get_search_content` / `web_enable` family. */
	allowWeb: boolean;
	/** `mcp`, `mcpScript` and every `mcp__<server>` proxy tool. */
	allowMcp: boolean;
	/** `nlm` on the command line. */
	allowNlm: boolean;
}

/**
 * The strictest reading: ten tool calls and no capability at all until the parent says otherwise.
 * Ten rather than the parent's default 25, because a child that lost its limits should still be able
 * to read a handful of files and submit — and no more.
 */
export const DEFAULT_CHILD_LIMITS: ChildLimits = {
	maxToolCalls: 10,
	allowWeb: false,
	allowMcp: false,
	allowNlm: false,
};

/**
 * A known role, or `psychologist` when the value is missing or junk.
 *
 * The role picks the submission schema, not a capability, so the fallback is the plugin's primary
 * role — the most constrained shape it has — rather than a placeholder that accepts anything.
 */
export function parseChildRole(value: unknown): ChildRole {
	return typeof value === "string" && (CHILD_ROLES as readonly string[]).includes(value)
		? (value as ChildRole)
		: "psychologist";
}

/**
 * Parse `PI_DEVS_PSYCH_LIMITS` (JSON) into a budget, key by key.
 *
 * Only an explicit `true` enables a capability: `"true"`, `1` and every junk value stay off. A
 * non-negative integer `maxToolCalls` is honoured, `0` included (a child allowed to read nothing is a
 * legitimate, if austere, limit); anything else falls back.
 */
export function parseChildLimits(json: unknown): ChildLimits {
	let parsed: unknown;
	if (typeof json === "string" && json.trim().length > 0) {
		try {
			parsed = JSON.parse(json);
		} catch {
			parsed = undefined;
		}
	}
	const source =
		parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: {};
	const max = source.maxToolCalls;
	return {
		// `typeof` first, not `Number(...)`: the parent writes `JSON.stringify`, so a numeric STRING is
		// not a near miss to be coerced, it is a value this child could not read — and the strict
		// reading of an unreadable budget is the small one.
		maxToolCalls: typeof max === "number" && Number.isInteger(max) && max >= 0 ? max : DEFAULT_CHILD_LIMITS.maxToolCalls,
		allowWeb: source.allowWeb === true,
		allowMcp: source.allowMcp === true,
		allowNlm: source.allowNlm === true,
	};
}
