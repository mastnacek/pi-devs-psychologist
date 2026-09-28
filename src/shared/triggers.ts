/**
 * triggers — the evidence rule that decides *whether* an appraisal is worth its tokens.
 *
 * The plugin's cost model used to be a clock: every `cadenceTurns`, ask the model. A clock
 * spends on a healthy stretch exactly as much as on a blocking one, and it re-appraises old
 * evidence it has already seen. This file replaces the clock with a delta rule (D7): the model
 * runs when the evidence contains something *new* worth appraising.
 *
 * Two properties make this trustworthy, and both are structural rather than promised:
 *
 * - **Pure.** `evaluateTriggers` reads two plain snapshots and computes; no I/O, no state, no
 *   model. Which is why the whole policy is unit-testable per reason.
 * - **Delta-based.** Every reason compares the *current* counters against a `baseline` snapshot
 *   taken at the last attempt, so the same old failure never fires twice. `baseline` is exactly
 *   what `snapshotTriggers` captured at that attempt.
 *
 * The thresholds live in config (`triggerThresholds`) and are normalised per key, so an operator
 * can tune what counts as a reason without editing this file.
 */

import type { SessionSignals } from "./signals.js";
import type { SessionHistory } from "./history.js";

/**
 * The reason vocabulary. Kept as a list rather than a union literal so a later task (T15's
 * `commit_unverified`) can extend it in one place; `evaluateTriggers` stays the only decider.
 */
export const TRIGGER_REASONS = [
	"failure_streak",
	"recurring_failure",
	"restatement",
	"operator_abort",
	"stale_progress",
	"compaction",
	"thinking_raised",
	"delivered",
] as const;

export type TriggerReason = (typeof TRIGGER_REASONS)[number];

/** Per-reason thresholds. Each is a count; junk and negatives fall back in `config.ts`. */
export interface TriggerThresholds {
	/** Consecutive failed tool calls at the tail of the window. */
	failureStreak: number;
	/** One fingerprint's count, at or above which the recurrence is worth naming. */
	recurringFailure: number;
	/** New restatements since baseline. */
	restatement: number;
	/** New aborted turns since baseline. */
	operatorAbort: number;
	/** `turnsSinceVerifiedProgress` crossing this value since baseline. */
	staleProgress: number;
	/** New compactions since baseline. */
	compaction: number;
	/** New operator thinking-level raises since baseline. */
	thinkingRaised: number;
	/** New deliveries (a verified run after a real change set) since baseline. */
	delivered: number;
}

export const DEFAULT_TRIGGER_THRESHOLDS: TriggerThresholds = {
	failureStreak: 3,
	recurringFailure: 2,
	restatement: 1,
	operatorAbort: 1,
	staleProgress: 6,
	compaction: 1,
	thinkingRaised: 1,
	delivered: 1,
};

/** The two folds a trigger reads: the live window and the session record. */
export interface TriggerInput {
	signals: SessionSignals;
	history: SessionHistory;
}

/**
 * Counters captured at the last appraisal attempt. Every field is a plain count, so the
 * snapshot serialises cleanly and a missing field reads as zero.
 */
export interface TriggerBaseline {
	failureStreak: number;
	/** `toolName + signature` → count, so a fingerprint can be compared per signature. */
	fingerprints: Record<string, number>;
	restatedPrompts: number;
	abortedTurns: number;
	turnsSinceVerifiedProgress: number;
	compactions: number;
	thinkingRaises: number;
	deliveredRuns: number;
}

/** One spelling of the fingerprint key, shared by the snapshot and the comparison. */
export function fingerprintKey(toolName: string, signature: string): string {
	return `${toolName} ${signature}`;
}

/** The baseline before any attempt: all counters zero, so the first real signal fires. */
export const EMPTY_TRIGGER_BASELINE: TriggerBaseline = {
	failureStreak: 0,
	fingerprints: {},
	restatedPrompts: 0,
	abortedTurns: 0,
	turnsSinceVerifiedProgress: 0,
	compactions: 0,
	thinkingRaises: 0,
	deliveredRuns: 0,
};

/**
 * Snapshot the counters at an attempt, so the next evaluation is a delta against *this* state.
 *
 * Deliberately a copy, not a reference: the live folds are rebuilt each turn, and a snapshot that
 * aliased one would drift with it and never fire a second time.
 */
export function snapshotTriggers(current: TriggerInput): TriggerBaseline {
	const fingerprints: Record<string, number> = {};
	for (const fingerprint of current.signals.failureFingerprints) {
		fingerprints[fingerprintKey(fingerprint.toolName, fingerprint.signature)] = fingerprint.count;
	}
	return {
		failureStreak: current.signals.failureStreak,
		fingerprints,
		restatedPrompts: current.signals.restatedPrompts,
		abortedTurns: current.history.abortedTurns,
		turnsSinceVerifiedProgress: current.signals.turnsSinceVerifiedProgress,
		compactions: current.history.compactions,
		thinkingRaises: current.history.thinkingRaises,
		deliveredRuns: current.signals.deliveredRuns,
	};
}

/**
 * Decide whether the evidence since `baseline` contains anything new.
 *
 * Returns every reason that holds, not just the first: the trigger line names them all, and a
 * reader (and the model) benefits from seeing that a streak *and* a restatement happened together.
 */
export function evaluateTriggers(
	current: TriggerInput,
	baseline: TriggerBaseline,
	thresholds: TriggerThresholds,
): { fire: boolean; reasons: TriggerReason[] } {
	const { signals, history } = current;
	const reasons: TriggerReason[] = [];

	if (
		signals.failureStreak >= thresholds.failureStreak &&
		signals.failureStreak > baseline.failureStreak
	) {
		reasons.push("failure_streak");
	}

	const recurring = signals.failureFingerprints.some((fingerprint) => {
		const before = baseline.fingerprints[fingerprintKey(fingerprint.toolName, fingerprint.signature)] ?? 0;
		return fingerprint.count >= thresholds.recurringFailure && fingerprint.count > before;
	});
	if (recurring) reasons.push("recurring_failure");

	if (signals.restatedPrompts - baseline.restatedPrompts >= thresholds.restatement) {
		reasons.push("restatement");
	}
	if (history.abortedTurns - baseline.abortedTurns >= thresholds.operatorAbort) {
		reasons.push("operator_abort");
	}

	// A *crossing*, not a level: the point of `stale_progress` is the moment the unverified stretch
	// becomes notable, and re-firing every turn past six would be exactly the clock this file removes.
	if (
		baseline.turnsSinceVerifiedProgress < thresholds.staleProgress &&
		signals.turnsSinceVerifiedProgress >= thresholds.staleProgress
	) {
		reasons.push("stale_progress");
	}

	if (history.compactions - baseline.compactions >= thresholds.compaction) {
		reasons.push("compaction");
	}
	if (history.thinkingRaises - baseline.thinkingRaises >= thresholds.thinkingRaised) {
		reasons.push("thinking_raised");
	}
	if (signals.deliveredRuns - baseline.deliveredRuns >= thresholds.delivered) {
		reasons.push("delivered");
	}

	return { fire: reasons.length > 0, reasons };
}
