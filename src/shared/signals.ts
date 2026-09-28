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
	isCommitCommand,
	isUnscoped,
	isVerificationCommand,
	overlap,
	tokenize,
} from "./lexicon.js";
import { describeSignals } from "./signals-evidence.js";

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
	/**
	 * Fixed-vocabulary classification of the tool's error, when it failed and the error
	 * text was recognisable. See `lexicon.classifyFailure` for why the text itself is
	 * discarded: it can carry code and paths, and this evidence leaves the machine.
	 */
	errorSignature?: string;
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
	/** Whether the delivery-boundary fold runs at all (`config.commitCheck`, T15). */
	commitCheck: boolean;
}

export const DEFAULT_SIGNAL_OPTIONS: SignalOptions = {
	restatementThreshold: 0.6,
	unscopedWordFloor: DEFAULT_UNSCOPED_WORD_FLOOR,
	idleGapMs: 10 * 60 * 1000,
	maxObservations: 600,
	commitCheck: true,
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
	/**
	 * Failures grouped by `toolName` + signature, most frequent first. This is the line that
	 * separates "the edit tool could not find its target string" from "the suite is red" —
	 * two failures with opposite remedies, identical in every other count.
	 */
	failureFingerprints: FailureFingerprint[];
	/** Distinct files a mutation tool targeted. */
	filesTouched: number;
	/** Files mutated more than once, most frequent first. */
	churnedFiles: string[];
	/** Successful runs of a verification command (test / lint / typecheck / build). */
	verificationRuns: number;
	/**
	 * Commits (`git commit` etc.) made while a change set was still unverified. Counted for the
	 * `commit_unverified` trigger (T15); 0 when `commitCheck` is off.
	 */
	unverifiedCommits: number;
	/** File changes pending at the most recent of those commits — the evidence line's N. */
	unverifiedCommitChanges: number;
	/**
	 * Consecutive failed tool calls at the tail of the window, ignoring non-tool entries between
	 * them. The trigger rule for `failure_streak` reads this against a baseline snapshot.
	 */
	failureStreak: number;
	/**
	 * Successful verification runs that followed at least four mutations since the previous such
	 * run — a real change set that proved itself. Fed to the `delivered` trigger, which is the one
	 * "a win worth naming" signal the window can produce.
	 */
	deliveredRuns: number;
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

/** One tool's failures of one kind, counted. */
export interface FailureFingerprint {
	toolName: string;
	signature: string;
	count: number;
}

/** Median of a numeric list; 0 for an empty list. Shared with `history.ts`. */
export function median(values: readonly number[]): number {
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

/**
 * Group failures by tool and signature.
 *
 * A failure with no recognised signature still counts, as `unclassified failure` — dropping
 * it would make the fingerprint lines disagree with the `tool failures:` total beside them,
 * and a reader comparing the two would be right to distrust both.
 */
function fingerprintFailures(failures: readonly ToolObservation[]): FailureFingerprint[] {
	const counts = new Map<string, FailureFingerprint>();
	for (const tool of failures) {
		const signature = tool.errorSignature ?? "unclassified failure";
		const key = `${tool.toolName}\u0000${signature}`;
		const existing = counts.get(key);
		if (existing) {
			existing.count += 1;
			continue;
		}
		counts.set(key, { toolName: tool.toolName, signature, count: 1 });
	}
	return [...counts.values()].sort(
		(a, b) => b.count - a.count || a.toolName.localeCompare(b.toolName) || a.signature.localeCompare(b.signature),
	);
}

/** Consecutive failed tool calls at the tail, skipping non-tool entries between them. */
function trailingFailureStreak(log: readonly Observation[]): number {
	let streak = 0;
	for (let i = log.length - 1; i >= 0; i -= 1) {
		const item = log[i];
		if (item.kind !== "tool") continue;
		if (item.ok) break;
		streak += 1;
	}
	return streak;
}

/**
 * Successful mutation-tool calls since the last successful verification run.
 *
 * This is the number a delivery boundary reports: how much unproven work a commit is shipping.
 * A commit does not reset it (the change set is still unproven) — only a successful verification
 * does. Shared by the signal fold and the observer's commit check so the two can never disagree.
 */
export function mutationsSinceVerified(log: readonly Observation[]): number {
	let count = 0;
	for (const item of log) {
		if (item.kind !== "tool") continue;
		if (isVerificationCommand(item.command)) {
			if (item.ok) count = 0;
			continue;
		}
		if (item.ok && MUTATION_TOOLS.has(item.toolName)) count += 1;
	}
	return count;
}

/**
 * Count commits made with an unverified change set, and the change count of the most recent one.
 *
 * Reuses `mutationsSinceVerified` per commit index rather than a parallel accumulator, so the
 * evidence line can never disagree with the helper the observer notifies from. O(n²) over a
 * bounded window (≤ `maxObservations`) — deliberately simple, cheap at these sizes.
 */
function scanUnverifiedCommits(log: readonly Observation[]): { commits: number; changes: number } {
	let commits = 0;
	let changes = 0;
	log.forEach((item, index) => {
		if (item.kind !== "tool" || !item.ok || !isCommitCommand(item.command)) return;
		const pending = mutationsSinceVerified(log.slice(0, index + 1));
		if (pending === 0) return;
		commits += 1;
		changes = pending;
	});
	return { commits, changes };
}

/**
 * Count successful verification runs that closed a real change set (≥ 4 mutations since the
 * previous one). The mutation counter resets on every successful verification, pass or not: a
 * run that proved nothing still ends the change set it was run against.
 */
function countDeliveredRuns(log: readonly Observation[]): number {
	let delivered = 0;
	let mutationsSinceVerified = 0;
	for (const item of log) {
		if (item.kind !== "tool") continue;
		if (isVerificationCommand(item.command)) {
			if (!item.ok) continue;
			if (mutationsSinceVerified >= 4) delivered += 1;
			mutationsSinceVerified = 0;
			continue;
		}
		if (item.ok && MUTATION_TOOLS.has(item.toolName)) mutationsSinceVerified += 1;
	}
	return delivered;
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
	// The delivery-boundary fold is opt-out: `commitCheck: false` means it does not run at all, so
	// no line, no counter and no trigger — the same switch that silences the observer notification.
	const commitScan = opts.commitCheck ? scanUnverifiedCommits(log) : { commits: 0, changes: 0 };

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
		failureFingerprints: fingerprintFailures(failures),
		filesTouched: new Set(mutatedPaths).size,
		churnedFiles: repeatedByFrequency(mutatedPaths),
		verificationRuns,
		unverifiedCommits: commitScan.commits,
		unverifiedCommitChanges: commitScan.changes,
		failureStreak: trailingFailureStreak(log),
		deliveredRuns: countDeliveredRuns(log),
		turnsSinceVerifiedProgress,
		idleGaps,
		longestIdleGapMs,
		unverifiedWindow: turns.length > 0 && verificationRuns === 0,
		evidence: [],
	};
	signals.evidence = describeSignals(signals, opts.idleGapMs);
	return signals;
}
