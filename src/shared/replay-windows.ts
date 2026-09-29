/**
 * replay-windows — cut a replayed observation log into the appraisal windows the live appraiser
 * would have produced, one per `cadenceTurns` turns.
 *
 * The live appraiser folds the whole observation log on every `turn_end`. Offline there is no
 * `turn_end`, so this file is the stand-in: it cuts the log at the SAME cadence and folds each
 * prefix exactly as the appraiser does — `extractSignals` + `describeSignals` for the LIVE block,
 * `foldHistory` for the SESSION block, and `evaluateTriggers` for the reason list, with the baseline
 * taken from the previous window. Every prompt built here is byte-identical to a live one because it
 * goes through the same `buildUserText` and `allowedEvidence`.
 *
 * Pure: no filesystem, no clock, no model.
 */

import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { foldHistory, type SessionHistory } from "./history.js";
import { allowedEvidence, buildUserText } from "./prompt.js";
import {
	DEFAULT_SIGNAL_OPTIONS,
	extractSignals,
	type Observation,
	type SessionSignals,
	type SignalOptions,
} from "./signals.js";
import { describeSignals } from "./signals-evidence.js";
import {
	DEFAULT_TRIGGER_THRESHOLDS,
	EMPTY_TRIGGER_BASELINE,
	evaluateTriggers,
	snapshotTriggers,
	type TriggerBaseline,
	type TriggerReason,
	type TriggerThresholds,
} from "./triggers.js";
import { entryTime } from "./replay.js";

/** One appraisal window: the two evidence blocks a prompt needs, plus why it would have fired. */
export interface ReplayWindow {
	/** 0-based position of the window in the session. */
	index: number;
	/** The observation prefix folded into this window (what `extractSignals` was given). */
	observations: Observation[];
	/** LIVE evidence lines (the recent observation window). */
	liveLines: string[];
	/** SESSION evidence lines (the whole session's record up to this window's end). */
	sessionLines: string[];
	/** The exact user message the appraiser would have sent: `buildUserText(liveLines, sessionLines)`. */
	userText: string;
	/** The lines enforcement matches citations against: `allowedEvidence(liveLines, sessionLines)`. */
	evidenceLines: string[];
	/** The trigger reasons that would have fired this window (empty when none held). */
	triggerReasons: TriggerReason[];
}

export interface WindowOptions {
	/** Cut a window every this many `turn` observations (the live appraiser's cadence). */
	cadenceTurns: number;
	/** The signal-fold options for the replays (restatement threshold, commit check, …). */
	signal?: Partial<SignalOptions>;
	/** Idle-gap threshold for `describeSignals`, in ms. */
	idleGapMs?: number;
	/** The trigger thresholds. */
	thresholds?: TriggerThresholds;
}

/** The SESSION block for a prefix: the entries whose timestamp is at or before the cut. */
function historyPrefix(entries: readonly SessionEntry[], at: number): SessionHistory {
	// An entry with no parseable timestamp cannot be ordered; it is kept rather than dropped, so a
	// malformed line never silently removes a model switch or an aborted turn from the record.
	const prefix = entries.filter((entry) => {
		const ms = entryTime(entry);
		return ms === undefined || ms <= at;
	});
	return foldHistory(prefix);
}

/** Fold one observation prefix into a window. */
function buildWindow(
	index: number,
	prefix: readonly Observation[],
	entries: readonly SessionEntry[],
	options: WindowOptions,
): { window: ReplayWindow; signals: SessionSignals; history: SessionHistory } {
	const signals = extractSignals(prefix, options.signal ?? DEFAULT_SIGNAL_OPTIONS);
	const idleGapMs = options.idleGapMs ?? DEFAULT_SIGNAL_OPTIONS.idleGapMs;
	const liveLines = describeSignals(signals, idleGapMs);
	const at = prefix[prefix.length - 1]?.at ?? 0;
	const history = historyPrefix(entries, at);
	const sessionLines = history.evidence;
	return {
		window: {
			index,
			observations: [...prefix],
			liveLines,
			sessionLines,
			userText: buildUserText(liveLines, sessionLines),
			evidenceLines: allowedEvidence(liveLines, sessionLines),
			triggerReasons: [],
		},
		signals,
		history,
	};
}

/**
 * Cut the observation log into appraisal windows.
 *
 * A window ends at every `cadenceTurns`-th `turn` observation; a trailing partial window is added
 * for the observations after the last cut, and a session too short to reach the cadence still
 * yields ONE window covering it. Without that last part an offline run over a five-minute session
 * would produce nothing to measure, which would make the harness useless exactly where a short
 * session's eval matters most.
 */
export function sliceWindows(
	observations: readonly Observation[],
	entries: readonly SessionEntry[],
	options: WindowOptions,
): ReplayWindow[] {
	if (observations.length === 0) return [];
	const cadence = Math.max(1, Math.floor(options.cadenceTurns));
	const thresholds = options.thresholds ?? DEFAULT_TRIGGER_THRESHOLDS;

	// The cut offsets, in observation indices: the end (inclusive) of each window.
	const cuts: number[] = [];
	let turns = 0;
	observations.forEach((item, index) => {
		if (item.kind !== "turn") return;
		turns += 1;
		if (turns % cadence === 0) cuts.push(index);
	});
	if (cuts.length === 0 || cuts[cuts.length - 1] < observations.length - 1) {
		cuts.push(observations.length - 1);
	}

	const windows: ReplayWindow[] = [];
	let baseline: TriggerBaseline = { ...EMPTY_TRIGGER_BASELINE };
	for (let i = 0; i < cuts.length; i += 1) {
		const end = cuts[i];
		const prefix = observations.slice(0, end + 1);
		const { window, signals, history } = buildWindow(i, prefix, entries, options);
		window.triggerReasons = evaluateTriggers({ signals, history }, baseline, thresholds).reasons;
		windows.push(window);
		// The baseline moves on every window, exactly as it moves on every live attempt, so the same
		// old evidence cannot fire the next window too.
		baseline = snapshotTriggers({ signals, history });
	}
	return windows;
}
