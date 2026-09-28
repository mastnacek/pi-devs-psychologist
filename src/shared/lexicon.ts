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

/** Word count above which an anchor-less prompt is reported as unscoped. */
export const DEFAULT_UNSCOPED_WORD_FLOOR = 25;

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