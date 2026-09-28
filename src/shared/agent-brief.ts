/**
 * agent-brief — what a headless child pi is told before it appraises a session (T23).
 *
 * The child is a full pi agent: it has tools, skills, MCP servers and its own system prompt. Two
 * things must be true regardless. First, the child must receive *exactly* the input today's API
 * runtime sends (`SYSTEM_PROMPT` + `buildUserText`) so an appraisal cannot depend on which runtime
 * formed it (D2) — the shared part is assembled here, never reworded. Second, the child must know
 * what it is, where it is and what it is allowed to touch, because a model that guesses at its own
 * environment guesses wrong.
 *
 * This module is PURE: it takes strings and values and returns strings. No filesystem, no
 * environment, no clock. The resolved docs directory is passed in (see `pi-paths.ts`), so the same
 * input always yields the same brief and a test can pin every line.
 */

import { INTERVENTION_KINDS, LOAD_LEVELS, NEED_STATES, PROGRESS_STATES, FLOW_STATES } from "./appraisal.js";
import type { ChildRole } from "./child-limits.js";
import { buildUserText, SYSTEM_PROMPT } from "./prompt.js";

/**
 * The one paragraph of `SYSTEM_PROMPT` that tells the model to answer with JSON. In agent runtime
 * the answer travels through `psych_submit`, not as final text (D3), so only this paragraph changes.
 *
 * Reproduced here verbatim (same interpolated enums, same two lines) so the replacement is a plain
 * exact-substring operation. If a future edit to `SYSTEM_PROMPT` moves or rewrites it, the module
 * load below throws instead of silently shipping a child told to "answer with JSON" that never
 * calls the tool.
 */
const OUTPUT_PARAGRAPH_ANCHOR = [
	"Answer with ONE JSON object and nothing else, no prose and no code fences:",
	`{"needs":{"autonomy":{"state":"<${NEED_STATES.join("|")}>","cited":[]},"competence":{"state":"<...>","cited":[]},"relatedness":{"state":"<...>","cited":[]}},"load":{"level":"<${LOAD_LEVELS.join("|")}>","cited":[]},"progress":{"state":"<${PROGRESS_STATES.join("|")}>","cited":[]},"flow":{"state":"<${FLOW_STATES.join("|")}>","cited":[]},"interventions":[{"kind":"<${INTERVENTION_KINDS.join("|")}>","text":"one actionable sentence","cited":[]}]}`,
].join("\n");

/** The model-facing constant that replaces the output paragraph for the psychologist role. */
export const SUBMIT_OUTPUT_INSTRUCTION =
	"Submit your answer by calling `psych_submit` exactly once, with the same fields.";

/**
 * `SYSTEM_PROMPT` with the output paragraph swapped for the submit instruction. Computed at module
 * load, and loud when the anchor is gone.
 */
const PSYCHOLOGIST_SYSTEM_PROMPT: string = (() => {
	if (!SYSTEM_PROMPT.includes(OUTPUT_PARAGRAPH_ANCHOR)) {
		throw new Error(
			"agent-brief: the SYSTEM_PROMPT output paragraph anchor was not found. The prompt was " +
				"edited without updating agent-brief.ts; the child would be told to answer with JSON " +
				"instead of calling psych_submit. Update OUTPUT_PARAGRAPH_ANCHOR to match prompt.ts.",
		);
	}
	return SYSTEM_PROMPT.replace(OUTPUT_PARAGRAPH_ANCHOR, SUBMIT_OUTPUT_INSTRUCTION);
})();

/**
 * The relative paths of the engine docs the brief points at, in the order they are listed.
 *
 * `docs.json` first (the navigation index), then the topic files, then the package-root files as
 * `../…` because their paths are shown relative to the docs directory. A test walks this list
 * against the real installed engine and skips when it cannot find it, so a docs file that moves
 * upstream is caught rather than printed into a brief as a dead path.
 */
export const PI_DOC_FILES = [
	"docs.json",
	"extensions.md",
	"skills.md",
	"packages.md",
	"settings.md",
	"sessions.md",
	"session-format.md",
	"json.md",
	"rpc.md",
	"sdk.md",
	"tui.md",
	"keybindings.md",
	"models.md",
	"providers.md",
	"prompt-templates.md",
	"security.md",
	"../README.md",
	"../CHANGELOG.md",
] as const;

/** The limits the brief honours; a subset of `ChildLimits`, so both read the same field names. */
export interface BriefLimits {
	maxToolCalls: number;
	allowWeb: boolean;
	allowMcp: boolean;
	allowNlm: boolean;
}

export interface AgentBriefInput {
	/** Which role the child is running as; picks the role paragraph and (later) the schema. */
	role: ChildRole;
	/** The running engine version, interpolated into "Where you are". */
	piVersion: string;
	/** The absolute engine docs directory, or `undefined` when it could not be resolved. */
	docsDir: string | undefined;
	/** LIVE evidence lines, passed to `buildUserText` unchanged. */
	liveLines: readonly string[];
	/** SESSION evidence lines, passed to `buildUserText` unchanged. */
	sessionLines: readonly string[];
	/** What the child may do (T22's limits). */
	limits: BriefLimits;
	/** NotebookLM notebook ids the child may query; only meaningful when `allowNlm`. */
	nlmNotebooks: string[];
	/** A bounded, scrubbed session excerpt (T28). Prepended to the final instruction when present. */
	digest?: string;
}

export interface AgentBrief {
	/** Written to a file and passed to the child via `--append-system-prompt`. */
	systemAppend: string;
	/** Written to a file and passed to the child via `@<file>`. */
	userMessage: string;
}

/**
 * The role paragraph. Only the psychologist has a real one today; the other three get a short
 * placeholder that shares every section below.
 *
 * TODO(T30/T31/T32): give `ask`, `scout` and `pair` their own role paragraphs.
 */
function roleParagraph(role: ChildRole): string {
	if (role === "psychologist") return PSYCHOLOGIST_SYSTEM_PROMPT;
	return (
		`You are the pi-devs-psychologist extension running headless in the \`${role}\` role. ` +
		"You are an observer: you never change files, never commit, never install, and your only " +
		"output is one `psych_submit` call."
	);
}

/** The "Where you are" section (item 2). */
function whereYouAre(piVersion: string): string {
	return [
		"## Where you are",
		`You run inside the pi coding agent, version \`${piVersion}\`, started headless by the ` +
			"pi-devs-psychologist extension to observe *another* pi session. The operator works with " +
			"pi every day and develops pi plugins in this workspace.",
		"You are an observer. You never change files, never commit, never install. Your only output " +
			"is one `psych_submit` call.",
	].join("\n\n");
}

/** The "Pi documentation" section (item 3). Omitted with a note when the docs dir is unknown. */
function piDocumentation(docsDir: string | undefined): string {
	if (!docsDir) {
		return [
			"## Pi documentation",
			"The installed pi documentation could not be found on this machine. Do not state facts " +
				"about pi's configuration, API or CLI from memory; say instead that you cannot verify " +
				"them here.",
		].join("\n\n");
	}
	const bullets = PI_DOC_FILES.map((file) =>
		file === "docs.json" ? `- \`${file}\` — navigation index; read it first to find a topic` : `- \`${file}\``,
	);
	return [
		"## Pi documentation",
		`The installed pi documentation is at \`${docsDir}\`; the paths below are relative to it.`,
		bullets.join("\n"),
		"Read only the file a question needs.",
	].join("\n\n");
}

/** The "Pi packages" section (item 4). Fixed text. */
function piPackages(): string {
	return [
		"## Pi packages",
		"Community plugins are listed at https://pi.dev/packages. Search: " +
			"`https://pi.dev/packages?name=<term>` (fetch with `fetch_content`). A package page is " +
			"`https://pi.dev/packages/<name>` and shows its manifest, install command and README. " +
			"Install specs look like `npm:<name>` or `git:github.com/<owner>/<repo>`. Run `pi list` " +
			"first so you never propose something already installed. Packages execute code: you may " +
			"*propose* one with its source link; you never install it.",
	].join("\n\n");
}

/** The "Tools you may use" section (item 5). Each capability bullet appears only when allowed. */
function toolsYouMayUse(limits: BriefLimits, nlmNotebooks: readonly string[]): string {
	const bullets: string[] = [];
	if (limits.allowWeb) {
		bullets.push(
			"If `web_search` is not in your tool list, call `web_enable` first. Prefer `queries` with " +
				"2–3 angles. Cite URLs.",
		);
	}
	if (limits.allowMcp) {
		bullets.push(
			"`mcp({})` lists connected servers; `mcp({ search })` finds tools. Use `mcpScript` only " +
				"when chaining several calls.",
		);
	}
	bullets.push("Your prompt lists available skills. Load one with `read` on its path only when the task matches.");
	if (limits.allowNlm) {
		const notebooks = nlmNotebooks.length > 0 ? nlmNotebooks.join(", ") : "none configured — do not query one";
		bullets.push(
			'Run `nlm login --check`; if it fails, skip NotebookLM entirely (never run `nlm login`). ' +
				'Query with `nlm notebook query <id> "<question>"`. Allowed notebooks: ' +
				notebooks +
				". Never `nlm chat start`. Keep output small (no `--json` dumps into context).",
		);
	}
	bullets.push("`read`, `grep`/`find`/`ls`, `git diff`, `git log`, `git show` are fine.");
	return ["## Tools you may use", bullets.map((bullet) => `- ${bullet}`).join("\n")].join("\n\n");
}

/** The "Budget" section (item 6). */
function budgetSection(maxToolCalls: number): string {
	return [
		"## Budget",
		`At most \`${maxToolCalls}\` tool calls. Spend them only if they change your answer. Zero tool ` +
			"calls is a correct outcome when the evidence already decides.",
	].join("\n\n");
}

/** The "Research rule" section (item 7). */
function researchRule(): string {
	return [
		"## Research rule",
		"Evidence lines are the only basis for verdicts and the intervention. Research you do may " +
			"only fill `suggestions`, and every suggestion needs a `source` (URL, docs path, " +
			"`nlm:<id>`, or package spec).",
	].join("\n\n");
}

/** The exact final line `buildUserText` emits; replaced so the child is told to submit. */
const JSON_ONLY_FINAL_LINE = "Appraise the session now. JSON only.";

/** The final line the child sees. */
export const SUBMIT_FINAL_LINE = "Appraise the session now. Submit with psych_submit.";

/**
 * Build the user message: `buildUserText`'s evidence portion byte for byte (D2), the optional
 * digest block, and the submit instruction in place of the JSON-only line.
 */
function buildAgentUserText(input: AgentBriefInput): string {
	const base = buildUserText(input.liveLines, input.sessionLines);
	if (!base.endsWith(JSON_ONLY_FINAL_LINE)) {
		throw new Error(
			`agent-brief: buildUserText does not end with the expected final line ${JSON.stringify(
				JSON_ONLY_FINAL_LINE,
			)}; the user message cannot be amended safely.`,
		);
	}
	const evidence = base.slice(0, base.length - JSON_ONLY_FINAL_LINE.length);
	const digestBlock = input.digest ? `DIGEST — ${input.digest}\n\n` : "";
	return evidence + digestBlock + SUBMIT_FINAL_LINE;
}

/** Assemble both strings the runner writes to files. Pure: same input, same output. */
export function buildAgentBrief(input: AgentBriefInput): AgentBrief {
	const systemAppend = [
		roleParagraph(input.role),
		whereYouAre(input.piVersion),
		piDocumentation(input.docsDir),
		piPackages(),
		toolsYouMayUse(input.limits, input.nlmNotebooks),
		budgetSection(input.limits.maxToolCalls),
		researchRule(),
	].join("\n\n");

	return { systemAppend, userMessage: buildAgentUserText(input) };
}
