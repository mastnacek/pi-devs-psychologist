/**
 * outcome — the intervention ledger: does this plugin actually help?
 *
 * The plugin measures the SESSION, never the person (T16). Every delivered intervention opens a
 * record with a `before` snapshot of the session's own counters; once `outcomeWindowTurns` turns
 * have passed, the same counters are snapshotted again and compared metric by metric. The result
 * is a verdict per metric — `improved | unchanged | worse` — with no weighting and no single
 * aggregate score, because a composite would be a number about a programmer and this file only
 * ever reports a fact about a technique.
 *
 * Two consequences the design depends on:
 *
 * - **Plain comparisons.** One rule per metric, documented at `compareOutcome`: a session-level
 *   number either fell, rose, or held. There is no epsilon and no tuning; a threshold nobody can
 *   read is a threshold nobody can trust.
 * - **Pure.** Nothing here touches the engine, the clock or a model. The ledger is a plain list of
 *   records, so it can be folded, restored from session entries (T7's mechanism) and unit-tested
 *   without a running session.
 *
 * The ledger also feeds T17's anti-nag rule: a kind whose outcomes do not improve twice in a row
 * is muted for the session, so the same advice is never repeated into a void.
 */

import type { InterventionKind } from "./appraisal.js";
import type { SessionSignals } from "./signals.js";
import type { SessionHistory } from "./history.js";
import { overlap, tokenize } from "./lexicon.js";

/** The default number of turns an intervention is given to prove itself (T16). */
export const DEFAULT_OUTCOME_WINDOW_TURNS = 5;
/** The default number of turns a delivered kind stays "cooling" (T17). */
export const DEFAULT_COOLDOWN_TURNS = 6;
/**
 * Overlap at which the operator's next prompt counts as following the intervention (T16).
 * Deliberately BELOW `restatementThreshold` (0.6): a follow-up that acts on the advice borrows
 * fewer words than a verbatim restatement of it.
 */
export const FOLLOWED_OVERLAP = 0.4;

/** How the intervention reached the operator, mirroring the delivery policy's vocabulary. */
export type OutcomeChannel = "card" | "notification" | "steer";

/** The four session counters a verdict is computed from. Lower is better for every one. */
export interface OutcomeSnapshot {
	/** Failures / tool calls over the live window (`SessionSignals.toolFailureRate`). */
	failureRate: number;
	/** Completed turns since the last successful verification run. */
	turnsSinceVerifiedProgress: number;
	/** Prompts restating an earlier prompt (cumulative over the session). */
	restatements: number;
	/** Turns the operator cancelled (`stopReason: "aborted"`, cumulative). */
	aborts: number;
}

export type MetricVerdict = "improved" | "unchanged" | "worse";
export type MetricVerdicts = Record<keyof OutcomeSnapshot, MetricVerdict>;

/**
 * One delivered intervention and what came of it.
 *
 * Every field beyond the initial delivery is filled in later: `verdicts` when the window closes,
 * `followed` / `quickWinCalled` when a reaction is observed, `downgraded` when T17 drops a repeat.
 * Each change is appended as its own session entry (full snapshot, same `id`), so a `/reload` that
 * replays them in order reconstructs exactly this record.
 */
export interface OutcomeRecord {
	id: string;
	kind: InterventionKind;
	deliveredAtTurn: number;
	channel: OutcomeChannel;
	before: OutcomeSnapshot;
	/** The intervention text, kept so a follow-up prompt can be compared against it. */
	text: string;
	/** How long the card stayed open, ms — measured around `presentAppraisal` when a card rendered. */
	closedCardMs?: number;
	/** The `quick_win` tool ran within the window after a `name_next_win` intervention. */
	quickWinCalled?: boolean;
	/** The operator's next prompt shared ≥ `FOLLOWED_OVERLAP` of its tokens with the advice. */
	followed?: boolean;
	/** The snapshot once the window closed. Undefined while the outcome is still open. */
	after?: OutcomeSnapshot;
	/** Per-metric verdicts once the window closed. */
	verdicts?: MetricVerdicts;
	/** Set when T17 dropped a repeat of a muted kind instead of delivering it. */
	downgraded?: "cooldown";
}

/** The compact snapshot a delivery is judged against. */
export function snapshotOutcome(input: {
	signals: SessionSignals;
	history: SessionHistory;
}): OutcomeSnapshot {
	return {
		failureRate: input.signals.toolFailureRate,
		turnsSinceVerifiedProgress: input.signals.turnsSinceVerifiedProgress,
		restatements: input.signals.restatedPrompts,
		aborts: input.history.abortedTurns,
	};
}

/**
 * Compare one metric. Lower is better for all four; anything else is a held value, not a victory.
 *
 * The documented threshold is the whole rule: no epsilon, no percentage band. A strict drop is
 * `improved`, a strict rise is `worse`, everything else is `unchanged`. Introducing a dead-band
 * would be the first step toward a score, and this plugin reports techniques, not grades.
 */
function verdictFor(before: number, after: number): MetricVerdict {
	if (after < before) return "improved";
	if (after > before) return "worse";
	return "unchanged";
}

/** The per-metric verdicts for one closed window. */
export function compareOutcome(before: OutcomeSnapshot, after: OutcomeSnapshot): MetricVerdicts {
	return {
		failureRate: verdictFor(before.failureRate, after.failureRate),
		turnsSinceVerifiedProgress: verdictFor(
			before.turnsSinceVerifiedProgress,
			after.turnsSinceVerifiedProgress,
		),
		restatements: verdictFor(before.restatements, after.restatements),
		aborts: verdictFor(before.aborts, after.aborts),
	};
}

/**
 * True when a majority of the metrics were NOT improved.
 *
 * This is the precise muting rule T17 needs. With four metrics, "majority not improved" means at
 * most one metric improved (0 or 1 of 4): a technique that moved one counter while three stood
 * still is not a technique that is working.
 */
export function isNoImprovement(verdicts: MetricVerdicts): boolean {
	const values = Object.values(verdicts);
	const improved = values.filter((verdict) => verdict === "improved").length;
	return improved < values.length - improved;
}

/** Records whose window has closed, in delivery order. */
export function resolvedRecords(ledger: readonly OutcomeRecord[], kind: InterventionKind): OutcomeRecord[] {
	return ledger.filter((record) => record.kind === kind && record.verdicts !== undefined);
}

/** How many times a kind was actually delivered this session (the line's N). */
export function deliveredCount(ledger: readonly OutcomeRecord[], kind: InterventionKind): number {
	return ledger.filter((record) => record.kind === kind).length;
}

/** A kind becomes muted once two resolved windows both failed to improve. */
export function kindIsMuted(ledger: readonly OutcomeRecord[], kind: InterventionKind): boolean {
	const resolved = resolvedRecords(ledger, kind);
	if (resolved.length < 2) return false;
	const noImprovement = resolved.filter((record) => isNoImprovement(record.verdicts as MetricVerdicts)).length;
	return noImprovement > resolved.length - noImprovement;
}

export function mutedKinds(ledger: readonly OutcomeRecord[]): Set<InterventionKind> {
	const muted = new Set<InterventionKind>();
	for (const record of ledger) {
		if (kindIsMuted(ledger, record.kind)) muted.add(record.kind);
	}
	return muted;
}

/**
 * Kinds delivered within `cooldownTurns`, so the model is warned not to repeat them.
 *
 * `stop` is exempt from cooldown (T17): naming stopping once already gave that advice, and there
 * is nothing useful to repeat — but `stop` is still subject to muting, which `mutedKinds` decides.
 */
export function coolingKinds(
	ledger: readonly OutcomeRecord[],
	currentTurn: number,
	cooldownTurns: number,
): Set<InterventionKind> {
	const cooling = new Set<InterventionKind>();
	for (const record of ledger) {
		if (record.kind === "stop") continue;
		if (currentTurn - record.deliveredAtTurn < cooldownTurns) cooling.add(record.kind);
	}
	return cooling;
}

/**
 * The ONE live evidence line per kind to avoid, model-facing English (T17): cooling, muted, or
 * measured as not helping in its latest closed window.
 *
 * It is added to both the prompt and `allowedEvidence`, exactly like the T14 trigger line: a
 * warning the model cannot cite would be a warning the model is punished for obeying.
 */
export function doNotRepeatLines(
	ledger: readonly OutcomeRecord[],
	currentTurn: number,
	cooldownTurns: number,
): string[] {
	const cooling = coolingKinds(ledger, currentTurn, cooldownTurns);
	// "No change" is claimed only when a closed window measured it (the latest resolved outcome did
	// not improve, or the kind is muted). A kind that is merely cooling has no measurement yet, so
	// its line says so instead of asserting a result the ledger does not hold.
	const measuredNoChange = new Set<InterventionKind>(mutedKinds(ledger));
	for (const record of ledger) {
		// `stop` keeps its cooldown exemption here too: only muting silences it.
		if (record.kind === "stop") continue;
		const resolved = resolvedRecords(ledger, record.kind);
		const latest = resolved[resolved.length - 1];
		if (latest && isNoImprovement(latest.verdicts as MetricVerdicts)) measuredNoChange.add(record.kind);
	}
	const kinds = new Set<InterventionKind>([...cooling, ...measuredNoChange]);
	return [...kinds].sort().map((kind) => {
		const why = measuredNoChange.has(kind) ? "no change" : "cooling down";
		return `do not repeat: ${kind} (named ${deliveredCount(ledger, kind)} times, ${why})`;
	});
}

/**
 * Close every window that `windowTurns` turns have now elapsed on.
 *
 * Mutates the records in place (they are the live ledger) and returns the ones that just closed,
 * so the caller can append one follow-up session entry per record.
 */
export function resolveDueOutcomes(
	ledger: OutcomeRecord[],
	currentTurn: number,
	windowTurns: number,
	snapshot: OutcomeSnapshot,
): OutcomeRecord[] {
	const closed: OutcomeRecord[] = [];
	for (const record of ledger) {
		if (record.verdicts !== undefined) continue;
		if (currentTurn - record.deliveredAtTurn < windowTurns) continue;
		record.after = snapshot;
		record.verdicts = compareOutcome(record.before, snapshot);
		closed.push(record);
	}
	return closed;
}

/** Per-kind delivery tally for `/psych effect`. Counters count METRIC verdicts, not deliveries. */
export interface KindEffect {
	kind: InterventionKind;
	delivered: number;
	improved: number;
	unchanged: number;
	worse: number;
	followed: number;
}

/** Fold the ledger into one row per kind that was delivered at least once. */
export function effectByKind(ledger: readonly OutcomeRecord[]): KindEffect[] {
	const kinds: InterventionKind[] = [];
	for (const record of ledger) if (!kinds.includes(record.kind)) kinds.push(record.kind);
	return kinds.map((kind) => {
		const records = ledger.filter((record) => record.kind === kind);
		const row: KindEffect = { kind, delivered: records.length, improved: 0, unchanged: 0, worse: 0, followed: 0 };
		for (const record of records) {
			if (record.followed) row.followed += 1;
			for (const verdict of Object.values(record.verdicts ?? {})) {
				if (verdict === "improved") row.improved += 1;
				else if (verdict === "unchanged") row.unchanged += 1;
				else if (verdict === "worse") row.worse += 1;
			}
		}
		return row;
	});
}

/**
 * The `followed` reaction: the operator's next prompt shares ≥ `FOLLOWED_OVERLAP` with the advice.
 *
 * Decided on the first prompt after delivery and then never revised, so a later unrelated prompt
 * cannot un-follow an intervention that was in fact acted on.
 */
export function noteFollowed(ledger: readonly OutcomeRecord[], promptText: string): void {
	const tokens = tokenize(promptText);
	if (tokens.length === 0) return;
	for (const record of ledger) {
		if (record.followed !== undefined || record.verdicts !== undefined) continue;
		record.followed = overlap(tokens, tokenize(record.text)) >= FOLLOWED_OVERLAP;
	}
}

/** The `quick_win` reaction: that tool ran within an open `name_next_win` window. */
export function noteQuickWin(ledger: readonly OutcomeRecord[], toolName: string): void {
	if (toolName !== "quick_win") return;
	for (const record of ledger) {
		if (record.kind !== "name_next_win" || record.verdicts !== undefined) continue;
		record.quickWinCalled = true;
	}
}

/**
 * Rebuild the ledger from session entries (T7's TUI-only mechanism).
 *
 * Entries never enter model context; they are replayed here in order and merged by `id`, so each
 * later append (a closed window, an observed reaction, a drop) updates the record it belongs to.
 * Junk entries are ignored rather than trusted — a hand-edited session must not crash a reload.
 */
export function restoreOutcomes(
	entries: readonly { type?: string; customType?: string; data?: unknown }[] | undefined,
): OutcomeRecord[] {
	const byId = new Map<string, OutcomeRecord>();
	const order: string[] = [];
	for (const entry of entries ?? []) {
		if (entry?.type !== "custom" || entry.customType !== "psych-outcome") continue;
		const data = entry.data;
		if (data === null || typeof data !== "object") continue;
		const record = data as OutcomeRecord;
		if (typeof record.id !== "string") continue;
		if (byId.has(record.id)) {
			// A follow-up append (a closed window, a reaction) carries only what changed; it merges
			// into the record it belongs to rather than needing the full shape again.
			Object.assign(byId.get(record.id) as OutcomeRecord, record);
			continue;
		}
		if (typeof record.kind !== "string") continue;
		byId.set(record.id, { ...record });
		order.push(record.id);
	}
	return order.map((id) => byId.get(id) as OutcomeRecord);
}
