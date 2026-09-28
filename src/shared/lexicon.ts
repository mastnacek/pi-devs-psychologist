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

// --- T22: the read-only child's deny list ----------------------------------------------------

/**
 * Tools the child pi must not call (T22, D4). The child runs with the whole workshop loadout
 * (spike Q6), so this is a deny list with a catch-all, not an allow list: a tool the child genuinely
 * needs is never on it, and a tool whose *name* smells like a mutation is refused by pattern below,
 * so a newly installed `something_writer` cannot slip through merely by being unlisted.
 *
 * `MUTATION_TOOLS` is reused rather than repeated: `edit` and `write` are its members, and the guard's
 * whole purpose is to stop file mutation, so the codebase's own definition of "a tool that touches a
 * file" is the right starting set.
 */
export const CHILD_FORBIDDEN_TOOLS: ReadonlySet<string> = new Set([
	...MUTATION_TOOLS,
	"ast_grep_replace",
	"record_spai_item",
	"update_spai_status",
	"workflow",
	"workflow_control",
	"batch_submit_goal",
	"subagent",
	"subagents_enable",
	"plugin_dev_scaffold",
	"add_project_root",
	"add_project_manually",
]);

/** Any tool whose name says it writes, removes or installs, listed or not. */
export const CHILD_FORBIDDEN_TOOL_PATTERN = /(write|edit|delete|replace|install|remove|scaffold|create|rename)/i;

/**
 * The child's own submission tool, which the pattern must never catch and the read-only rule must
 * never block: it is the only way the child is allowed to speak (D3).
 */
export const CHILD_SUBMIT_TOOL = "psych_submit";

/** True when the child must not call this tool. */
export function isChildForbiddenTool(toolName: string): boolean {
	if (toolName === CHILD_SUBMIT_TOOL) return false;
	return CHILD_FORBIDDEN_TOOLS.has(toolName) || CHILD_FORBIDDEN_TOOL_PATTERN.test(toolName);
}

/**
 * A shell command that starts a new statement: the beginning, or after a pipe, `;`, `&&`, `||`,
 * a subshell bracket or a newline. Anchoring to a statement start is what keeps `cat src/copy.ts`
 * readable — a bare word-boundary test would refuse to read any file with "copy" in its name.
 */
const COMMAND_START =
	"(?:^|[;&|()\\n])\\s*" +
	// Wrappers that run the next word as the command: `sudo rm`, `env A=1 git push`, `xargs rm`.
	// Without this, one prefix word walks straight past every entry below.
	"(?:(?:sudo|doas|env|command|nohup|time|exec|xargs)\\s+(?:-\\S+\\s+|\\w+=\\S*\\s+)*)*";

/** `git` plus any global options before the subcommand: `git -c a=b commit`, `git -C dir push`. */
const GIT = "git(?:\\s+(?:-[cC]\\s+\\S+|--?[\\w-]+(?:=\\S+)?))*";

/**
 * Bash forms the child must not run (T22, D4), each with the reason the model is told.
 *
 * A readable list like every other table here, and deliberately narrow so the read-only work stays
 * possible: `git diff` / `git log` / `git show`, `npm test`, `ls`, `cat`, and (when the run allows it)
 * `nlm notebook query` must all pass. The list is a floor, not a proof: a shell form nobody thought of
 * is still a way through, which is why the brief forbids mutation in prose as well.
 */
export const CHILD_FORBIDDEN_BASH: ReadonlyArray<readonly [RegExp, string]> = [
	[
		new RegExp(`${COMMAND_START}${GIT}\\s+(?:commit|push|reset|checkout|switch|clean|rebase|merge|stash|tag|rm|mv)\\b`, "i"),
		"this git command changes or publishes state",
	],
	[
		new RegExp(`${COMMAND_START}(?:rm|rmdir|del|mv|move|cp|copy)\\b`, "i"),
		"this command deletes, moves or copies files",
	],
	[new RegExp(`${COMMAND_START}tee\\b`, "i"), "`tee` writes to a file"],
	[
		new RegExp(`${COMMAND_START}(?:Remove-Item|Set-Content|Out-File)\\b`, "i"),
		"this PowerShell cmdlet writes to disk",
	],
	[
		new RegExp(`${COMMAND_START}(?:npm|pnpm|yarn|bun)\\s+(?:i|install|add|publish|uninstall)\\b`, "i"),
		"this package-manager command installs or publishes",
	],
	[
		new RegExp(`${COMMAND_START}pi\\s+(?:install|remove|uninstall|update|config)\\b`, "i"),
		"this pi command changes what is installed",
	],
	[
		new RegExp(`${COMMAND_START}gh\\s+(?:repo|pr|issue|release)\\s+(?:create|edit|delete|merge|close)\\b`, "i"),
		"this GitHub command writes",
	],
	[
		new RegExp(`${COMMAND_START}nlm\\s+(?:notebook|source|note)\\s+(?:create|delete|add|rename|update)\\b`, "i"),
		"this NotebookLM command changes the notebook",
	],
	[new RegExp(`${COMMAND_START}nlm\\s+login\\b`, "i"), "`nlm login` is interactive"],
	[new RegExp(`${COMMAND_START}nlm\\s+chat\\s+start\\b`, "i"), "`nlm chat start` opens a REPL"],
	[
		// Interpreter one-liners that reach the filesystem: `node -e "fs.writeFileSync(...)"`,
		// `python -c "open(p,'w')"`. Matched on the write API, so `node -e "console.log(1)"` passes.
		new RegExp(
			`${COMMAND_START}(?:node|deno|bun|python3?|py|ruby|perl)\\b[^|;&]*\\s(?:-e|-c|--eval|-p)\\b.*(?:writeFile|appendFile|rmSync|rmdir|unlink|rename|mkdir|copyFile|createWriteStream|open\\([^)]*['"][wa]|shutil|os\\.remove)`,
			"i",
		),
		"this interpreter one-liner writes to disk",
	],
	[
		/\bsed\b[^|;&<>]*\s(?:-i|--in-place)\b/i,
		"`sed -i` rewrites the file in place",
	],
	[
		/\b(?:curl|wget)\b[^|;&<>]*(?:\s-[oO]\b|--output\b)/i,
		"this download is written to a file",
	],
];

/**
 * Where a `>` or `>>` sends its output, if anywhere.
 *
 * Needs a function rather than a list entry because the decision is about the TARGET: `2>&1`
 * duplicates a file descriptor and `> /dev/null` (or `> nul`) discards output — both are read-only
 * plumbing — while `> out.txt` is a write. A bare `\btarget\b` pattern cannot tell them apart.
 */
export function forbiddenRedirection(command: string): string | undefined {
	for (const match of command.matchAll(/(>>?)\s*([^\s|;&<>]+)/g)) {
		const target = match[2];
		if (target.startsWith("&")) continue;
		if (/^\/dev\/(?:null|stdout|stderr)$/i.test(target)) continue;
		if (/^nul$/i.test(target)) continue;
		return target;
	}
	return undefined;
}

/**
 * Why the child must not run this command, or `undefined` when it may.
 *
 * The reason is model-facing, so it says what the command would do and nothing about the operator.
 */
export function childBashBlockReason(command: string | undefined): string | undefined {
	if (!command) return undefined;
	for (const [pattern, reason] of CHILD_FORBIDDEN_BASH) {
		if (pattern.test(command)) return reason;
	}
	const target = forbiddenRedirection(command);
	if (target !== undefined) return `this command redirects output into ${target}`;
	return undefined;
}