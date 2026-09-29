/**
 * replay-eval — the eval set: arithmetic over two replayed runs, so a prompt change can be MEASURED
 * instead of argued.
 *
 * The whole point of the replay harness is that a prompt edit is a hypothesis. This file turns two
 * runs of the same session — before and after an edit — into four numbers per run, with no model and
 * no judgement: verdicts kept, claims dropped, citationRate, and the intervention kind. A change that
 * lowers `citationRate` or raises `claimsDropped` is worse by these numbers, and that is the point.
 *
 * Everything here reads the ENFORCEMENT output (what the citation contract already decided) rather
 * than re-deciding it, so the eval cannot disagree with what the plugin would actually deliver.
 *
 * Pure: no filesystem, no clock, no model.
 */

import { NEEDS, NEUTRAL, type InterventionKind } from "./appraisal.js";
import type { EnforcementResult } from "./appraisal-enforce.js";

/** One replayed window's result: the prompt inputs, the raw answer, and what enforcement made of it. */
export interface ReplayRunResult {
	windowIndex: number;
	reasons: string[];
	/** The LIVE evidence lines the window supplied. */
	liveLines: string[];
	/** The SESSION evidence lines the window supplied. */
	sessionLines: string[];
	/** The model's own response text, verbatim (empty on a `--dry` run). */
	responseText: string;
	/** The enforced appraisal and the notes about what was dropped. */
	enforcement: EnforcementResult;
}

/** The per-window numbers, computed from one run result. */
export interface WindowMetrics {
	/** Non-neutral verdicts that survived enforcement. */
	verdictsKept: number;
	/** Claims downgraded to neutral because nothing supported them. */
	claimsDropped: number;
	/** Kept citations ÷ supplied citations (1 when the model supplied none). */
	citationRate: number;
	/** The intervention the window would have delivered, if any. */
	interventionKind: InterventionKind | undefined;
	/** Total surviving citations across every verdict and the intervention. */
	citations: number;
	/** Every non-neutral verdict rests on at least one supplied line. */
	allVerdictsCited: boolean;
	/** The window produced at least one non-neutral verdict. */
	hasVerdict: boolean;
}

/** The across-window numbers, computed from a run's window metrics. */
export interface AggregateMetrics {
	/** Windows whose every kept verdict cites a supplied line ÷ windows with a verdict. */
	precision: number;
	/** Neutral verdicts ÷ all verdicts — how often the observer abstained. */
	abstentionRate: number;
	/** Surviving citations ÷ windows that delivered an intervention. */
	meanCitationsPerFinding: number;
	/**
	 * Mean per-window citation rate (mean of `WindowMetrics.citationRate`, not a ratio of sums):
	 * a window that offered three claims and matched one is not the same evidence as a window that
	 * offered one and matched it, and averaging the rates keeps both visible. The renderer needs a
	 * single number; this is it.
	 */
	citationRate: number;
	verdictsKept: number;
	claimsDropped: number;
	citations: number;
}

export interface WindowEval {
	windowIndex: number;
	before: WindowMetrics;
	after: WindowMetrics;
	/** True when the two runs differ in response, citation rate or intervention kind. */
	changed: boolean;
	kindBefore: InterventionKind | undefined;
	kindAfter: InterventionKind | undefined;
}

export interface ReplayEval {
	windows: WindowEval[];
	before: AggregateMetrics;
	after: AggregateMetrics;
}

/** The six verdicts each window carries: three needs, load, progress, flow. */
function verdicts(enforcement: EnforcementResult): { state: string; cited: string[]; neutral: string }[] {
	const a = enforcement.appraisal;
	return [
		...NEEDS.map((need) => ({
			state: a.needs[need].state as string,
			cited: a.needs[need].cited,
			neutral: NEUTRAL.needs[need] as string,
		})),
		{ state: a.load.level, cited: a.load.cited, neutral: NEUTRAL.load },
		{ state: a.progress.state, cited: a.progress.cited, neutral: NEUTRAL.progress },
		{ state: a.flow.state, cited: a.flow.cited, neutral: NEUTRAL.flow },
	];
}

/** Compute one window's numbers from its (already enforced) result. */
export function measureWindow(run: ReplayRunResult): WindowMetrics {
	const rows = verdicts(run.enforcement);
	const kept = rows.filter((row) => row.state !== row.neutral);
	const citations =
		rows.reduce((sum, row) => sum + row.cited.length, 0) +
		run.enforcement.appraisal.interventions.reduce((sum, item) => sum + item.cited.length, 0);
	// The model "supplied" every citation it wrote; enforcement kept the ones that matched. So the
	// denominator is what it kept plus what it lost, and the rate is honesty per attempted claim.
	const supplied = citations + run.enforcement.unmatched.length;
	return {
		verdictsKept: kept.length,
		claimsDropped: run.enforcement.downgraded.length,
		citationRate: supplied === 0 ? 1 : citations / supplied,
		interventionKind: run.enforcement.appraisal.interventions[0]?.kind,
		citations,
		allVerdictsCited: kept.every((row) => row.cited.length > 0),
		hasVerdict: kept.length > 0,
	};
}

/** Roll a run's window metrics into its aggregate numbers. */
export function aggregate(metrics: readonly WindowMetrics[]): AggregateMetrics {
	const withVerdict = metrics.filter((m) => m.hasVerdict);
	const findings = metrics.filter((m) => m.interventionKind !== undefined);
	const totalVerdicts = metrics.length * 6;
	const neutral = metrics.reduce((sum, m) => sum + (6 - m.verdictsKept), 0);
	const citations = metrics.reduce((sum, m) => sum + m.citations, 0);
	return {
		precision:
			withVerdict.length === 0
				? 0
				: withVerdict.filter((m) => m.allVerdictsCited).length / withVerdict.length,
		abstentionRate: totalVerdicts === 0 ? 0 : neutral / totalVerdicts,
		meanCitationsPerFinding: findings.length === 0 ? 0 : citations / findings.length,
		citationRate: metrics.length === 0 ? 0 : metrics.reduce((sum, m) => sum + m.citationRate, 0) / metrics.length,
		verdictsKept: metrics.reduce((sum, m) => sum + m.verdictsKept, 0),
		claimsDropped: metrics.reduce((sum, m) => sum + m.claimsDropped, 0),
		citations,
	};
}

/** Index a run's results by window, newest value winning when a window appears twice. */
function byWindow(runs: readonly ReplayRunResult[]): Map<number, ReplayRunResult> {
	const map = new Map<number, ReplayRunResult>();
	for (const run of runs) map.set(run.windowIndex, run);
	return map;
}

/**
 * Compare two runs window by window, and aggregate each.
 *
 * Windows present in only one run are still compared, with the missing side reported as an empty
 * result — a run that produced FEWER windows is itself a finding, not a reason to drop the window.
 */
export function evaluateRuns(
	before: readonly ReplayRunResult[],
	after: readonly ReplayRunResult[],
): ReplayEval {
	const beforeMap = byWindow(before);
	const afterMap = byWindow(after);
	const indices = [...new Set([...beforeMap.keys(), ...afterMap.keys()])].sort((a, b) => a - b);
	const empty: ReplayRunResult = {
		windowIndex: -1,
		reasons: [],
		liveLines: [],
		sessionLines: [],
		responseText: "",
		enforcement: { appraisal: emptyAppraisal(), unmatched: [], downgraded: [] },
	};

	const beforeMetrics: WindowMetrics[] = [];
	const afterMetrics: WindowMetrics[] = [];
	const windows: WindowEval[] = [];
	for (const index of indices) {
		const b = measureWindow(beforeMap.get(index) ?? { ...empty, windowIndex: index });
		const a = measureWindow(afterMap.get(index) ?? { ...empty, windowIndex: index });
		beforeMetrics.push(b);
		afterMetrics.push(a);
		windows.push({
			windowIndex: index,
			before: b,
			after: a,
			changed:
				(b.interventionKind ?? "") !== (a.interventionKind ?? "") ||
				b.citationRate !== a.citationRate ||
				(beforeMap.get(index)?.responseText ?? "") !== (afterMap.get(index)?.responseText ?? ""),
			kindBefore: b.interventionKind,
			kindAfter: a.interventionKind,
		});
	}

	return { windows, before: aggregate(beforeMetrics), after: aggregate(afterMetrics) };
}

/** A neutral appraisal, for a window one of the runs never produced. Local to avoid a cycle. */
function emptyAppraisal(): EnforcementResult["appraisal"] {
	return {
		needs: {
			autonomy: { state: NEUTRAL.needs.autonomy, cited: [] },
			competence: { state: NEUTRAL.needs.competence, cited: [] },
			relatedness: { state: NEUTRAL.needs.relatedness, cited: [] },
		},
		load: { level: NEUTRAL.load, cited: [] },
		progress: { state: NEUTRAL.progress, cited: [] },
		flow: { state: NEUTRAL.flow, cited: [] },
		interventions: [],
		suggestions: [],
	};
}
