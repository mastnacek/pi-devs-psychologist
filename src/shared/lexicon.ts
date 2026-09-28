/**
 * lexicon — the pattern tables the signal fold matches against, in one place.
 *
 * Separated from `signals.ts` for one reason: every heuristic in this plugin is
 * a *list someone can read and disagree with*. Keeping the lists together, away
 * from the arithmetic that consumes them, makes the plugin's whole notion of
 * "progress", "scope" and "correction" auditable in a single screen — which is
 * the only way a psychological reading of a session can be trusted at all.
 *
 * Naming rule: a helper is named for what it matches, never for what it might
 * mean. `hasCorrectionMarker` reports a marker; the interpretation is the
 * appraiser's job and it must cite the count.
 *
 * The exception, and it is deliberate: `classifyFailure` does assign meaning,
 * because "the edit tool could not find the string it was told to replace" is a
 * mechanical fact about a tool, not a reading of a person. The interpretation of
 * what it MEANS — stale context, an autofmt rewriting the file, two writers
 * racing — is still the appraiser's, and it must cite the count like any other
 * signal.
 */

/** Mutation tools, whose `path` argument counts as touching a file. */
export const MUTATION_TOOLS = new Set(["edit", "write", "apply_patch", "str_replace"]);

/**
 * A command counts as verification when it can actually fail on the work in
 * question. Deliberately narrow: `cat file` is not verification, and a plugin
 * that counts it as progress teaches the model to see progress that isn't there.
 */
export const VERIFICATION_PATTERNS: RegExp[] = [
	/\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:test|tests|lint|typecheck|check|build)\b/i,
	/\b(?:node|tsx|deno|bun)\s+--test\b/i,
	/\b(?:npx\s+)?(?:pytest|vitest|jest|mocha|rspec|phpunit)\b/i,
	/\bcargo\s+(?:test|check|clippy|build)\b/i,
	/\bgo\s+(?:test|build|vet)\b/i,
	/\btsc\b/i,
	/\bmake\s+(?:test|check|build|all)\b/i,
];

/**
 * Commands that ship work to the world — the delivery boundary (T15). Readable like every other
 * list here: `git commit`, `git push`, `gh pr create`, `npm publish`. Deliberately NOT
 * `pi update`, which publishes nothing — and a dry run (`--help`) is fine to ignore.
 */
export const COMMIT_COMMANDS: RegExp[] = [
	/\bgit\s+commit\b/i,
	/\bgit\s+push\b/i,
	/\bgh\s+pr\s+create\b/i,
	/\bnpm\s+publish\b/i,
];

/** True when a shell command is one that delivers work. A match, not a judgement. */
export function isCommitCommand(command: string | undefined): boolean {
	if (!command) return false;
	return COMMIT_COMMANDS.some((pattern) => pattern.test(command));
}

/**
 * Correction markers, English and Czech, because the operator writes both.
 * A count of matches, not a verdict: "again" in "let's try again" is a
 * correction, "again" in "again, that's the third file" is not.
 */
export const CORRECTION_MARKERS: string[] = [
	"again",
	"still",
	"wrong",
	"not what i",
	"didn't work",
	"did not work",
	"doesn't work",
	"does not work",
	"broken",
	"znovu",
	"je\u0161t\u011b",
	"jeste",
	"zase",
	"\u0161patn\u011b",
	"spatne",
	"ne tak",
	"nefunguje",
	"nesed\u00ed",
	"nesedi",
	"op\u011bt",
	"opet",
];

/** Anchors that make a prompt concrete: a file, a path, a command, an identifier. */
export const ANCHOR_PATTERNS: RegExp[] = [
	/`[^`]+`/,
	/\b[\w.-]+\.(?:ts|tsx|js|jsx|mjs|cjs|json|md|py|rs|go|lua|java|cs|sql|html|css|yaml|yml|toml|sh|ps1|dxl|lss|fl|txt)\b/i,
	/\b(?:test|tests|tsc|lint|npm|pnpm|yarn|bun|cargo|pytest|vitest|jest|build|git)\b/i,
	/\b\w+\s*\(\s*\)/,
	/[\\/][\w.-]+(?:[\\/][\w.-]+)+/,
];

/**
 * Word count above which an anchor-less prompt is reported as unscoped. */
export const DEFAULT_UNSCOPED_WORD_FLOOR = 25;

/**
 * Failure signatures — a FIXED vocabulary, matched in order, first match wins.
 *
 * Why a closed vocabulary and not a redacted excerpt of the real error: the raw text of a
 * failed tool call carries file contents, shell arguments and absolute paths. Every one of
 * those would leave the machine in an evidence line, and this plugin already sends filenames
 * — adding a code excerpt is a step too far. A signature chosen from our own table cannot
 * leak anything, because nothing from the failure reaches it.
 *
 * The trade is honest and stated: an unrecognised error becomes `unclassified failure`, which
 * tells the appraiser less than the raw text would. It still tells it more than a bare count,
 * and "we do not recognise this" is a true thing to report.
 */
export const FAILURE_SIGNATURES = [
	"oldText did not match",
	"file not found",
	"permission denied",
	"tool not found",
	"language server error",
	"context limit exceeded",
	"parse error",
	"timed out",
	"rate limited",
	"authentication failed",
	"aborted",
	"other failure",
	"unclassified failure",
] as const;

export type FailureSignature = (typeof FAILURE_SIGNATURES)[number];

/** Ordered patterns. Order is the priority: the earlier a cause appears, the more specific. */
const FAILURE_PATTERNS: ReadonlyArray<readonly [RegExp, FailureSignature]> = [
	[
		/old[\s_-]?text[\s\S]{0,40}(?:not found|does not match|does not appear|no longer|mismatch|could not be found)|string to replace not found|(?:could not|couldn't|unable to) find the (?:old ?text|string)/i,
		"oldText did not match",
	],
	[
		/ENOENT|no such file or directory|file not found|cannot find the (?:file|path)|does not exist/i,
		"file not found",
	],
	[/EACCES|EPERM|permission denied|access is denied|not permitted/i, "permission denied"],
	[
		/unknown tool|tool not found|no such tool|command not found|is not a registered tool|Unknown option/i,
		"tool not found",
	],
	[
		/\blsp\b|language server|diagnostic[s]? (?:error|failed)|failed to start.*server/i,
		"language server error",
	],
	[
		/context (?:length|window|size)[\s\S]{0,30}(?:exceed|too|limit)|too many tokens|maximum context|input length and `max_tokens` exceed/i,
		"context limit exceeded",
	],
	[/SyntaxError|Parse error|Unexpected token|expected \w+ (?:but|to) found|JSON\.parse/i, "parse error"],
	[/ETIMEDOUT|ESOCKETTIMEDOUT|timed? ?out/i, "timed out"],
	[/\b429\b|rate limit|too many requests|quota exceeded|insufficient_quota/i, "rate limited"],
	[
		/\b401\b|\b403\b|unauthorized|unauthorised|forbidden|invalid api[ _-]?key|authentication|not logged in/i,
		"authentication failed",
	],
	[/abort(?:ed)?|cancel(?:l)?ed|interrupted/i, "aborted"],
	[/ECONNRESET|socket hang up|network|fetch failed|ETIMAXCONN/i, "other failure"],
];

/** Extract whatever text a failed tool result carries, tolerating every shape the engine emits. */
export function errorTextFromResult(result: unknown): string | undefined {
	if (typeof result === "string") return result.length > 0 ? result : undefined;
	if (result === null || typeof result !== "object") return undefined;
	const record = result as Record<string, unknown>;
	for (const key of ["error", "message", "output", "result", "text"]) {
		const value = record[key];
		if (typeof value === "string" && value.length > 0) return value;
		if (value !== null && typeof value === "object") {
			const nested = errorTextFromResult(value);
			if (nested !== undefined) return nested;
		}
	}
	if (Array.isArray(record.content)) {
		const parts = record.content
			.map((part) => errorTextFromResult(part))
			.filter((part): part is string => typeof part === "string");
		if (parts.length > 0) return parts.join(" ");
	}
	return undefined;
}

/**
 * Fold a raw tool error into one of `FAILURE_SIGNATURES`.
 *
 * Returns `undefined` when there is no text to classify: a failure with no message is still a
 * counted failure, it just earns no fingerprint line.
 */
export function classifyFailure(raw: string | undefined): FailureSignature | undefined {
	if (typeof raw !== "string") return undefined;
	const text = raw.replace(/\s+/g, " ").trim();
	if (text.length === 0) return undefined;
	for (const [pattern, signature] of FAILURE_PATTERNS) {
		if (pattern.test(text)) return signature;
	}
	return "unclassified failure";
}

/** Normalise a prompt for overlap comparison: lowercase words, no punctuation. */
export function tokenize(text: string): string[] {
	return text
		.toLowerCase()
		.replace(/[^\p{L}\p{N}\s_-]+/gu, " ")
		.split(/\s+/)
		.filter((token) => token.length > 2);
}

/** Jaccard overlap of two token lists. 0 when either is empty. */
export function overlap(a: readonly string[], b: readonly string[]): number {
	if (a.length === 0 || b.length === 0) return 0;
	const left = new Set(a);
	const right = new Set(b);
	let shared = 0;
	for (const token of left) if (right.has(token)) shared += 1;
	const union = left.size + right.size - shared;
	return union === 0 ? 0 : shared / union;
}

/** True when the prompt carries no file, path, command or identifier. */
export function isUnscoped(text: string, wordFloor: number = DEFAULT_UNSCOPED_WORD_FLOOR): boolean {
	const words = text.trim().split(/\s+/).filter(Boolean).length;
	if (words < wordFloor) return false;
	return !ANCHOR_PATTERNS.some((pattern) => pattern.test(text));
}

/** True when a command is one that could actually fail on the work in question. */
export function isVerificationCommand(command: string | undefined): boolean {
	if (!command) return false;
	return VERIFICATION_PATTERNS.some((pattern) => pattern.test(command));
}

/** True when the text contains any correction marker. A match, not a judgement. */
export function hasCorrectionMarker(text: string): boolean {
	const lower = text.toLowerCase();
	return CORRECTION_MARKERS.some((marker) => lower.includes(marker));
}