/**
 * history slice — the opt-in cross-session delivery record (T10): one write, one report.
 *
 * The two halves are apart in time, exactly like the handoff ledger: the record is written at
 * `session_shutdown` and read only when the operator runs `/psych history`. Both are no-ops unless
 * `history.enabled` is true, and the write is a no-op per session — `session_shutdown` fires on
 * reload AND on exit, so an in-memory `historyFlushed` flag (set inside the same synchronous write)
 * stops the counts doubling. No session identifier is stored, so this is the only way to keep one
 * session from being written twice.
 *
 * What is stored, and what is never stored, is the promise in `src/shared/history-store.ts`; this
 * slice only decides the moments. It imports only `src/shared/`, so it is testable without the
 * composition root.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	appendHistory,
	deliveryVerdict,
	historyFilePath,
	readHistory,
	summarizeHistory,
	type HistoryLine,
} from "../../shared/history-store.js";
import { stringsFor } from "../../shared/i18n.js";
import { extractSignals, mutationsSinceVerified } from "../../shared/signals.js";
import { signalOptions, type DevsPsychologistState } from "../../shared/state.js";
import { renderHistory } from "./render.js";

/** Persist this session's record, once, when the feature is on. Never throws into the session. */
export function writeHistory(
	state: DevsPsychologistState,
	ctx: { cwd: string },
): void {
	if (!state.config.history.enabled) return;
	// A no-op second shutdown (reload then exit) must not append the same session twice.
	if (state.historyFlushed) return;
	state.historyFlushed = true;

	const path = historyFilePath(ctx.cwd, state.config.history.path);
	const signals = extractSignals(state.observations, signalOptions(state));
	// `at` is the write time, not the delivery instant: the record keeps no per-delivery clock, so
	// every line of one session shares its end timestamp. That is enough for a date range, and it is
	// one less fact about the session to store.
	const at = Date.now();
	const lines: HistoryLine[] = [
		{
			at,
			turns: state.turnCount,
			toolCalls: signals.toolCalls,
			failures: signals.toolFailures,
			verifiedRuns: signals.verificationRuns,
			unverifiedMutations: mutationsSinceVerified(state.observations),
		},
		...state.outcomes.map((record) => ({
			at,
			kind: record.kind,
			verdict: deliveryVerdict(record),
			followed: record.followed === true,
		})),
	];
	try {
		appendHistory(path, lines, { retentionDays: state.config.history.retentionDays, now: at });
	} catch {
		// An unwritable record must never break shutdown; the next session simply records nothing.
	}
}

/**
 * The `/psych history` report.
 *
 * Returns a status line when nothing should be rendered (the feature is off, or there is no
 * terminal), and `""` when it has already shown the table. Same contract as `/psych ask` and
 * `/psych scout`, so the command handler stays a thin switch.
 */
export function historyReport(state: DevsPsychologistState, ctx: ExtensionContext): string {
	const s = stringsFor(state.config.lang);
	// Off: nothing was written, nothing is read, and the operator is told how to turn it on.
	if (!state.config.history.enabled) return s.historyOff;
	if (!ctx.hasUI) return s.notTui;

	const path = historyFilePath(ctx.cwd, state.config.history.path);
	const { lines, dropped } = readHistory(path, {
		retentionDays: state.config.history.retentionDays,
		now: Date.now(),
	});
	const text = renderHistory({
		summary: summarizeHistory(lines),
		path,
		dropped,
		lang: state.config.lang,
		width: process.stdout?.columns ?? 0,
	});
	ctx.ui.notify(text, "info");
	return "";
}

/** Wire the shutdown write. The report is invoked through `CommandDeps`, not an event. */
export function registerHistory(pi: ExtensionAPI, state: DevsPsychologistState): void {
	state.track(
		pi.on("session_shutdown", (_event, ctx) => {
			writeHistory(state, ctx);
		}),
	);
}
