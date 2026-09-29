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
import { askQuestionBlock, buildUserText, SYSTEM_PROMPT } from "./prompt.js";
import {
	budgetSection,
	piDocumentation,
	piPackages,
	researchRule,
	toolsYouMayUse,
	whereYouAre,
	type BriefLimits,
} from "./agent-brief-sections.js";

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

/**
 * The model-facing constant that replaces the output paragraph for the psychologist role.
 *
 * The replacement anchor below stays byte-identical to `SYSTEM_PROMPT`, so the API runtime's prompt
 * is untouched (D2); only this instruction names the extra `suggestions` field, which research may
 * fill and which travels to the operator alone.
 */
export const SUBMIT_OUTPUT_INSTRUCTION = [
	"Submit your answer by calling `psych_submit` exactly once, with the same fields.",
	"You may add an optional `suggestions` array (at most 3); leave it out when research changed nothing.",
	"Each suggestion is `{ kind, text, source, cited? }`:",
	"- `kind` is one of: package | skill | doc | research | workflow.",
	"- `text` is one sentence (at most 200 chars) naming something the operator can pick up.",
	"- `source` must be where it came from, and must be one of: an `https://` URL; a path inside the pi docs directory listed above; `nlm:<notebookId>` for a notebook listed as allowed; or an install spec `npm:<name>` / `git:github.com/<owner>/<repo>`.",
	"- `cited` is optional (at most 2) and, when present, must copy evidence lines exactly.",
	"Suggestions reach the operator only: they are never sent to the working agent.",
].join("\n");

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
 * The relative paths of the engine docs the brief points at, re-exported from the sections module so
 * `agent-brief.ts` stays the one import for the brief's vocabulary.
 */
export { PI_DOC_FILES } from "./agent-brief-sections.js";
export type { BriefLimits } from "./agent-brief-sections.js";

/**
 * What the reviewer is told about the delivery it reviews (T32a). The parent computes nothing about
 * the diff: these are the two commit anchors and the convention file paths, and the child reads the
 * content itself.
 */
export interface ReviewBrief {
	/** The git HEAD recorded at the previous delivery, or `""` for the first. */
	lastDeliveryHead: string;
	/** The current git HEAD. */
	head: string;
	/** The cap on the combined diff the child is told to read. */
	maxDiffBytes: number;
	/** The repo's stated convention files the child reads when they exist. */
	conventionFiles: readonly string[];
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
	/** The operator's question, for the `ask` role (T30): placed as a `QUESTION — …` block. */
	question?: string;
	/** The friction being scouted, for the `scout` role (T31): placed as a `TOPIC — …` block. */
	topic?: string;
	/**
	 * The operator's plugin monorepo, for the `scout` role (T31). Resolved from config and passed in,
	 * so the brief stays pure; `""` omits the workshop sentence entirely.
	 */
	workshopDir?: string;
	/** The delivery anchors and convention paths, for the `reviewer` role (T32a). */
	review?: ReviewBrief;
}

export interface AgentBrief {
	/** Written to a file and passed to the child via `--append-system-prompt`. */
	systemAppend: string;
	/** Written to a file and passed to the child via `@<file>`. */
	userMessage: string;
}

/**
 * The `ask` role paragraph (T30). The operator asked a direct question, so the answer IS the product:
 * it must stand alone, cite what supports it, say so when the evidence does not answer it, and put
 * research into `suggestions` where a source can be checked. The prohibitions are the psychologist
 * prompt's, verbatim where they apply, because a direct question is no licence to diagnose.
 */
const ASK_ROLE_PARAGRAPH = [
	"You are the pi-devs-psychologist extension running headless in the `ask` role. The operator is asking you a direct question about their session or their pi setup, and your answer is the whole product.",
	"Answer the question yourself, in at most 800 characters of plain prose. It is the only thing the operator reads, so it must stand on its own: no preamble, no restating the question, no list of caveats.",
	"Cite the LIVE or SESSION lines that support any claim you make about the session, copied EXACTLY, at most 4. A claim you cannot cite is marked unsupported to the operator, so cite what decides it or leave it out.",
	"If the evidence does not answer the question, say plainly that you cannot tell from the evidence, and name what is missing. Never guess a fact, number, timestamp, file name or event: if it is not in a line, you do not know it.",
	"Facts you learned from research — a plugin, a doc, a notebook — belong in `suggestions`, not in the answer, and every suggestion needs a `source`.",
	"Never mention scores, streaks, productivity, efficiency, burnout, fatigue, stress, or any diagnosis or mental-health condition. You answer a question; you do not assess a person's health.",
].join("\n");

/**
 * The `scout` role paragraph (T31). Friction keeps recurring, so the child answers one question:
 * does the ecosystem already solve this, or is a small plugin worth building? It is told to prefer
 * an existing package over building, to reserve `fit: "solves"` for a clear fit, and where the
 * operator's own plugin monorepo is (read-only) when one is configured.
 */
const SCOUT_ROLE_PARAGRAPH = [
	"You are the pi-devs-psychologist extension running headless in the `scout` role. Friction in this session keeps recurring, and your job is to find out whether the pi ecosystem already solves it before anyone builds anything new.",
	"The evidence names the friction (and a `TOPIC — …` line names it directly when the operator gave one). Start with `pi list` so you never propose something already installed. Then search: `https://pi.dev/packages?name=<terms>` with 2–3 distinct terms (fetch with `fetch_content`), `npm search`, and GitHub. A package page is `https://pi.dev/packages/<name>` and shows its manifest, install command and README.",
	"Prefer an existing package over building. Report each real one as a candidate with its `name`, an `installSpec` (`npm:<name>` or `git:github.com/<owner>/<repo>`), an `url` (https only), a `why` (one sentence, ≤ 160 chars) and a `fit`.",
	"`fit` is `solves` ONLY when the package clearly covers the friction the evidence names; use `partial` when it covers part of it, and `inspiration` when it is worth studying but does not solve it. Mislabelling a plausible package `solves` sends the operator to install something that does not help.",
	"If no existing package fits, fill `build` with `{ title, oneLine }` describing the smallest plugin worth building. If nothing fits and nothing is worth building, submit an empty `candidates` list and no `build` — that is a valid, honest answer.",
	"You are an observer: you never edit, never install, never commit. You may propose a package with its source link; you never install it. Your only output is one `psych_submit` call.",
].join("\n");

/** The one scout sentence that depends on config: where the operator's own plugins live (T31). */
function scoutWorkshopSentence(workshopDir: string | undefined): string {
	const dir = (workshopDir ?? "").trim();
	if (dir.length === 0) return "";
	return `The operator keeps their own pi plugins in the monorepo at \`${dir}\`. Read the \`README.md\` of the plugins there to see what already exists; NEVER edit anything under it.`;
}

/**
 * The `reviewer` role paragraph (T32a). The reviewer's subject is the artifact, never the person.
 * It reads the change itself (the parent retained nothing), proposes at most one finding, and
 * abstains with `insufficient_context` when neither a stated rule nor an intent line decides it.
 */
const REVIEW_ROLE_PARAGRAPH = [
	"You are the pi-devs-psychologist extension running headless in the `reviewer` role. Your subject is the artifact — the change — never the person and never their mood. You review ONE delivery: the change since the last delivery, plus the repo's stated conventions.",
	"The parent retained nothing about the change: it did not read the diff, and it does not read your answer as instructions to anyone. You read the change yourself, and you PROPOSE. You never write, never edit, never commit, never install. Your only output is one `psych_submit` call.",
	"Citing is the whole discipline: a finding stands only on a stated rule you read from a convention file, or on a SESSION intent line copied EXACTLY. No citation, no claim. Reporting a rule you cannot name is exactly the fabrication this role refuses.",
	"One finding class per review, chosen from `verdict`:",
	"- `convention_mismatch`: the change contradicts a rule stated in a convention file. Put the rule in `rule` and cite the convention file (its path, or an exact quoted line).",
	"- `intent_vs_artifact`: the work contradicts what the session said it would do. Cite the SESSION line and put it in `intentLine` too.",
	"- `unverified_claim`: the change or the session asserts something no cited run proved.",
	"- `insufficient_context`: you cannot determine the answer. This is the DEFAULT and a correct answer — put why in `text`, leave `rule` and `file` empty, and cite nothing.",
	"`insufficient_context` beats a confident guess: a reviewer without the worker's full context is structurally prone to confident wrongness, so declining is a first-class outcome, not a failure.",
	"Never mention scores, streaks, productivity, efficiency, burnout, fatigue, stress, or any diagnosis. Never advise on the person. You review a change.",
].join("\n");

/**
 * The "delivery you review" section (T32a): the anchors, the exact commands the child runs, the
 * byte cap, and the convention files. Omitted when no review context was passed.
 */
function reviewSection(review: ReviewBrief): string {
	const last = review.lastDeliveryHead.trim();
	const head = review.head.trim();
	const files =
		review.conventionFiles.length > 0
			? review.conventionFiles.map((file) => `\`${file}\``).join(", ")
			: "none are configured — you cannot check convention adherence in this run";
	const committed =
		last.length > 0 ? `\`git diff ${last}..${head}\`` : `\`git show ${head}\``;
	return [
		"## The delivery you review",
		`You review one delivery, anchored on git commits. The current HEAD is \`${head}\`; the previous delivery was ${
			last.length > 0 ? `\`${last}\`` : "not recorded (this is the first)"
		}.`,
		[
			"Run these with your own tools, never assuming the parent already did:",
			`- ${committed} — the committed change`,
			"- `git diff` — the working tree, which is not yet committed",
			`- read each of these convention files that exists: ${files}`,
		].join("\n"),
		`The combined diff must not exceed ${review.maxDiffBytes} bytes. If it does, review the last ${review.maxDiffBytes} bytes and say in \`text\` what you left out.`,
	].join("\n\n");
}

/**
 * The role paragraph. The psychologist gets its full prompt, `ask` its own contract (T30), `scout`
 * its hunting contract (T31), `pair` the reviewer's finding contract (T32a).
 */
function roleParagraph(role: ChildRole, workshopDir: string | undefined): string {
	if (role === "psychologist") return PSYCHOLOGIST_SYSTEM_PROMPT;
	if (role === "ask") return ASK_ROLE_PARAGRAPH;
	if (role === "scout") {
		const sentence = scoutWorkshopSentence(workshopDir);
		return sentence.length > 0 ? `${SCOUT_ROLE_PARAGRAPH}\n${sentence}` : SCOUT_ROLE_PARAGRAPH;
	}
	if (role === "pair") return REVIEW_ROLE_PARAGRAPH;
	return (
		`You are the pi-devs-psychologist extension running headless in the \`${role}\` role. ` +
		"You are an observer: you never change files, never commit, never install, and your only " +
		"output is one `psych_submit` call."
	);
}

/** The exact final line `buildUserText` emits; replaced so the child is told to submit. */
const JSON_ONLY_FINAL_LINE = "Appraise the session now. JSON only.";

/** The final line the child sees for an appraisal. */
export const SUBMIT_FINAL_LINE = "Appraise the session now. Submit with psych_submit.";

/** The final line the child sees when it was asked a question (T30). */
export const ASK_FINAL_LINE = "Answer the question now. Submit with psych_submit.";

/** The final line the child sees when it was sent to scout the ecosystem (T31). */
export const SCOUT_FINAL_LINE = "Scout now. Submit with psych_submit.";

/** The final line the child sees when it was sent to review a delivery (T32a). */
export const REVIEW_FINAL_LINE = "Review the delivery now. Submit with psych_submit.";

/** The `TOPIC — …` block the scout role puts immediately before the final line (T31). */
export function scoutTopicBlock(topic: string): string {
	return `TOPIC — ${topic}\n\n`;
}

/**
 * Build the user message: `buildUserText`'s evidence portion byte for byte (D2), the optional
 * digest block, the optional `QUESTION — …` block (T30), and the submit instruction in place of
 * the JSON-only line.
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
	const questionBlock = input.role === "ask" && input.question ? askQuestionBlock(input.question) : "";
	const topicBlock = input.role === "scout" && input.topic ? scoutTopicBlock(input.topic) : "";
	const finalLine =
		input.role === "ask"
			? ASK_FINAL_LINE
			: input.role === "scout"
				? SCOUT_FINAL_LINE
				: input.role === "pair"
					? REVIEW_FINAL_LINE
					: SUBMIT_FINAL_LINE;
	return evidence + digestBlock + questionBlock + topicBlock + finalLine;
}

/** Assemble both strings the runner writes to files. Pure: same input, same output. */
export function buildAgentBrief(input: AgentBriefInput): AgentBrief {
	const systemAppend = [
		roleParagraph(input.role, input.workshopDir),
		...(input.role === "pair" && input.review ? [reviewSection(input.review)] : []),
		whereYouAre(input.piVersion),
		piDocumentation(input.docsDir),
		piPackages(),
		toolsYouMayUse(input.limits, input.nlmNotebooks),
		budgetSection(input.limits.maxToolCalls),
		researchRule(),
	].join("\n\n");

	return { systemAppend, userMessage: buildAgentUserText(input) };
}
