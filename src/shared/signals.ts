/**
 * signals — the OBJECTIVE substrate the psychologist reads.
 *
 * Every number here is arithmetic over observed session events. No model, no
 * judgement, no interpretation. That split is this plugin's central rule: a
 * psychologist that invents its evidence is worse than no psychologist, so the
 * model is only ever allowed to *read* these values and quote them — never to
 * produce them.
 *
 * Two consequences follow, and both are deliberate:
 *
 * - The heuristics are named for what they measure, not for what they might
 *   mean. `promptsWithCorrectionMarkers` counts marker matches; it does not
 *   claim the programmer was correcting. Interpretation belongs to the
 *   appraiser, which must cite the count. The tables live in `lexicon.ts`.
 * - An empty signal set is a valid result. A window with no verified progress
 *   and no failures produces `unverifiedWindow: true`, not a guess.
 *
 * `evidence` lines are the only thing that crosses into the model prompt, so
 * they stay factual and terse: they are paid for on every appraisal.
 */

import {
	DEFAULT_UNSCOPED_WORD_FLOOR,
	MUTATION_TOOLS,
	hasCorrectionMarker,
	isUnscoped,
	isVerificationCommand,
	overlap,
	tokenize,
} from "./lexicon.js";

/** One tool invocation, paired from its start (args) and end (ok) events. */
export interface ToolObservation {
	kind: "tool";
	at: number;
	toolName: string;
	/** Shell command, when the tool carries one (bash). */
	command?: string;
	/** File the tool targeted, when it carries one (edit / write / read). */
	path?: string;
	ok: boolean;
}

export interface PromptObservation {
	kind: "prompt";
	at: number;
	text: string;
}

/** A completed agent turn — the unit of "did time pass without progress". */
export interface TurnObservation {
	kind: "turn";
	at: number;
}

export type Observation = ToolObservation | PromptObservation | TurnObservation;

export interface SignalOptions {
	/** Token-overlap ratio at which a prompt counts as a restatement. */
	restatementThreshold: number;
	/** Word count above which an anchor-less prompt is reported unscoped. */
	unscopedWordFloor: number;
	/** Gap between consecutive prompts counted as an interruption. */
	idleGapMs: number;
	/** How many observations are retained. Bounds memory on a long session. */
	maxObservations: number;
}

export const DEFAULT_SIGNAL_OPTIONS: SignalOptions = {
	restatementThreshold: 0.6,
	unscopedWordFloor: DEFAULT_UNSCOPED_WORD_FLOOR,
	idleGapMs: 10 * 60 * 1000,
	maxObservations: 600,
};

export interface SessionSignals {
	/** Wall-clock span of the retained window, ms. */
	windowMs: number;
	promptCount: number;
	/** Prompts whose token overlap with an earlier prompt reached the threshold. */
	restatedPrompts: number;
	/** Long prompts matching no file, command, path or identifier. */
	unscopedPrompts: number;
	/** Prompts containing a correction marker. */
	promptsWithCorrectionMarkers: number;
	medianPromptChars: number;
	turns: number;
	toolCalls: number;
	toolFailures: number;
	/** Failures / calls, 0 when nothing ran. */
	toolFailureRate: number;
	/** Tool names that failed more than once, most frequent first. */
	failingTools: string[];
	/** Distinct files a mutation tool targeted. */
	filesTouched: number;
	/** Files mutated more than once, most frequent first. */
	churnedFiles: string[];
	/** Successful runs of a verification command (test / lint / typecheck / build). */
	verificationRuns: number;
	/** Completed turns since the last successful verification run. */
	turnsSinceVerifiedProgress: number;
	/** Pauses between prompts longer than the idle threshold. */
	idleGaps: number;
	longestIdleGapMs: number;
	/** True when the window ran but nothing verifiable ever succeeded. */
	unverifiedWindow: boolean;
	/**
	 * Factual one-liners handed to the appraiser. Every interpretive claim the
	 * model makes must trace back to one of these strings.
	 */
	evidence: string[];
}

function median(values: readonly number[]): number {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 1 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/** `path` values among mutation-tool observations, in order of occurrence. */
function mutationPaths(log: readonly Observation[]): string[] {
	const paths: string[] = [];
	for (const item of log) {
		if (item.kind !== "tool") continue;
		if (!MUTATION_TOOLS.has(item.toolName)) continue;
		if (typeof item.path === "string" && item.path.length > 0) paths.push(item.path);
	}
	return paths;
}

/** Values occurring more than once, most frequent first; ties alphabetical. */
function repeatedByFrequency(values: readonly string[]): string[] {
	const counts = new Map<string, number>();
	for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
	return [...counts.entries()]
		.filter(([, count]) => count > 1)
		.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
		.map(([value]) => value);
}

function countRestatements(promptTokens: readonly (readonly string[])[], threshold: number): number {
	let restated = 0;
	for (let i = 0; i < promptTokens.length; i += 1) {
		for (let j = 0; j < i; j += 1) {
			if (overlap(promptTokens[i], promptTokens[j]) >= threshold) {
				restated += 1;
				break;
			}
		}
	}
	return restated;
}

/**
 * Fold an observation log into the factual signal set.
 *
 * Index position in the log is the clock — the observer appends in event order.
 * `at` is used only for durations.
 */
export function extractSignals(
	log: readonly Observation[],
	options: Partial<SignalOptions> = {},
): SessionSignals {
	const opts: SignalOptions = { ...DEFAULT_SIGNAL_OPTIONS, ...options };
	const prompts = log.filter((item): item is PromptObservation => item.kind === "prompt");
	const tools = log.filter((item): item is ToolObservation => item.kind === "tool");
	const turns = log.filter((item): item is TurnObservation => item.kind === "turn");

	const failures = tools.filter((tool) => !tool.ok);
	const mutatedPaths = mutationPaths(log);

	// The last successful verification splits the window: everything after it is
	// work whose result is still unproven.
	let verificationRuns = 0;
	let lastVerificationIndex = -1;
	log.forEach((item, index) => {
		if (item.kind !== "tool") return;
		if (!item.ok || !isVerificationCommand(item.command)) return;
		verificationRuns += 1;
		lastVerificationIndex = index;
	});
	const turnsSinceVerifiedProgress = turns.filter(
		(turn) => lastVerificationIndex < 0 || log.indexOf(turn) > lastVerificationIndex,
	).length;

	let idleGaps = 0;
	let longestIdleGapMs = 0;
	for (let i = 1; i < prompts.length; i += 1) {
		const gap = prompts[i].at - prompts[i - 1].at;
		if (gap > longestIdleGapMs) longestIdleGapMs = gap;
		if (gap >= opts.idleGapMs) idleGaps += 1;
	}

	const first = log[0]?.at;
	const last = log[log.length - 1]?.at;
	const windowMs = first !== undefined && last !== undefined ? Math.max(0, last - first) : 0;

	const signals: SessionSignals = {
		windowMs,
		promptCount: prompts.length,
		restatedPrompts: countRestatements(
			prompts.map((prompt) => tokenize(prompt.text)),
			opts.restatementThreshold,
		),
		unscopedPrompts: prompts.filter((prompt) => isUnscoped(prompt.text, opts.unscopedWordFloor)).length,
		promptsWithCorrectionMarkers: prompts.filter((prompt) => hasCorrectionMarker(prompt.text)).length,
		turns: turns.length,
		medianPromptChars: median(prompts.map((prompt) => prompt.text.length)),
		toolCalls: tools.length,
		toolFailures: failures.length,
		toolFailureRate: tools.length === 0 ? 0 : failures.length / tools.length,
		failingTools: repeatedByFrequency(failures.map((tool) => tool.toolName)),
		filesTouched: new Set(mutatedPaths).size,
		churnedFiles: repeatedByFrequency(mutatedPaths),
		verificationRuns,
		turnsSinceVerifiedProgress,
		idleGaps,
		longestIdleGapMs,
		unverifiedWindow: turns.length > 0 && verificationRuns === 0,
		evidence: [],
	};
	signals.evidence = describeSignals(signals, opts.idleGapMs);
	return signals;
}

/** Minutes, rounded — the only unit a tired reader parses reliably. */
function minutes(ms: number): number {
	return Math.round(ms / 60000);
}

/**
 * The evidence lines. These are what the psychologist model reads, so they state
 * counts and never conclusions: "6/9 tool calls failed", not "the agent is
 * struggling". Only non-zero facts are emitted, plus one always-present window
 * line, so absence of a line is itself information the model is told to read as
 * absence.
 */
export function describeSignals(signals: SessionSignals, idleGapMs: number): string[] {
	const lines: string[] = [
		`window: ${signals.promptCount} prompt(s), ${signals.toolCalls} tool call(s), ${minutes(signals.windowMs)} min`,
	];
	if (signals.toolFailures > 0) {
		lines.push(
			`tool failures: ${signals.toolFailures}/${signals.toolCalls} (${Math.round(signals.toolFailureRate * 100)}%)` +
				(signals.failingTools.length > 0 ? `, repeated: ${signals.failingTools.join(", ")}` : ""),
		);
	}
	if (signals.turns === 0) {
		// Nothing ran. 'No verification succeeded' would be a claim about work
		// that does not exist, which is exactly the fabrication this plugin refuses.
		return lines;
	}
	lines.push(
		signals.verificationRuns === 0
			? "verified progress: none — no test, lint, typecheck or build succeeded in this window"
			: `verified progress: ${signals.verificationRuns} successful run(s); ${signals.turnsSinceVerifiedProgress} turn(s) since the last one`,
	);
	if (signals.restatedPrompts > 0) {
		lines.push(`prompts restating an earlier prompt: ${signals.restatedPrompts}`);
	}
	if (signals.promptsWithCorrectionMarkers > 0) {
		lines.push(`prompts containing a correction marker: ${signals.promptsWithCorrectionMarkers}`);
	}
	if (signals.unscopedPrompts > 0) {
		lines.push(`long prompts with no file, path, command or identifier: ${signals.unscopedPrompts}`);
	}
	if (signals.churnedFiles.length > 0) {
		lines.push(`files mutated more than once: ${signals.churnedFiles.slice(0, 5).join(", ")}`);
	}
	if (signals.idleGaps > 0) {
		lines.push(
			`pauses over ${minutes(idleGapMs)} min: ${signals.idleGaps} (longest ${minutes(signals.longestIdleGapMs)} min)`,
		);
	}
	return lines;
}