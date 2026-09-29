/**
 * agent-brief-sections — the fixed, config-independent sections of the child's system append (T23).
 *
 * Split out of `agent-brief.ts` by concept (and to keep both files under the line budget): this is
 * where the child is told that it is a headless observer, where pi's docs and packages are, what
 * tools it may use, its budget and the research rule. The role paragraphs and the assembly stay in
 * `agent-brief.ts`.
 *
 * These sections are pure English and identical in every locale: they are instructions to a model,
 * not copy for a person.
 */

/** The relative paths of the engine docs the brief points at, in the order they are listed. */
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

/** The "Where you are" section (item 2). */
export function whereYouAre(piVersion: string): string {
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
export function piDocumentation(docsDir: string | undefined): string {
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
export function piPackages(): string {
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
export function toolsYouMayUse(limits: BriefLimits, nlmNotebooks: readonly string[]): string {
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
export function budgetSection(maxToolCalls: number): string {
	return [
		"## Budget",
		`At most \`${maxToolCalls}\` tool calls. Spend them only if they change your answer. Zero tool ` +
			"calls is a correct outcome when the evidence already decides.",
	].join("\n\n");
}

/** The "Research rule" section (item 7). */
export function researchRule(): string {
	return [
		"## Research rule",
		"Evidence lines are the only basis for verdicts and the intervention. Research you do may " +
			"only fill `suggestions`, and every suggestion needs a `source` (URL, docs path, " +
			"`nlm:<id>`, or package spec).",
	].join("\n\n");
}
