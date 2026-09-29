/**
 * history slice — the opt-in cross-session delivery record (T10): one write, one report.
 *
 * The two halves are apart in time, exactly like the handoff ledger: the record is written at
 * `session_shutdown` and read only when the operator runs `/psych history`. Both are no-ops unless
 * `history.enabled` is true, and the write is a no-op per session — `session_shutdown` fires on
 * reload AND on exit, so the write is guarded by the session id in `state.historyFlushedFor`.
 * It is deliberately NOT a boolean cleared on `session_start`: a reload fires that too, so the
 * boolean was cleared by the event preceding the second shutdown and every session was written
 * twice. Keying on the id survives a reload and does not survive a new session. No session
 * identifier is ever STORED in the file; this one only lives in memory.
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

/**
 * The identity of this session for the write-once guard: the session id, else the file path, else
 * `undefined`. A context that exposes neither cannot be guarded, and the write proceeds — a doubled
 * line is a smaller failure than a missing one, and the alternative is dropping the operator's data
 * because the engine did not tell us who it is.
 */
function sessionKey(ctx: {
	sessionManager?: { getSessionId?: () => string; getSessionFile?: () => string | undefined };
}): string | undefined {
	const manager = ctx.sessionManager;
	if (manager === undefined) return undefined;
	if (typeof manager.getSessionId === "function") {
		const id = manager.getSessionId();
		if (typeof id === "string" && id.length > 0) return id;
	}
	if (typeof manager.getSessionFile === "function") {
		const file = manager.getSessionFile();
		if (typeof file === "string" && file.length > 0) return file;
	}
	return undefined;
}

/** Persist this session's record, once, when the feature is on. Never throws into the session. */
export function writeHistory(
	state: DevsPsychologistState,
	ctx: { cwd: string; sessionManager?: { getSessionId?: () => string; getSessionFile?: () => string | undefined } },
): void {
	if (!state.config.history.enabled) return;
	// A no-op second shutdown (reload then exit) must not append the same session twice. The key is
	// the session id, NOT a boolean cleared on `session_start`: a reload fires `session_start` too,
	// so a boolean is cleared by the event that precedes the second shutdown and every session is
	// written twice — which is what happened until the real composition root was driven end to end.
	const key = sessionKey(ctx);
	if (key !== undefined && state.historyFlushedFor === key) return;
	state.historyFlushedFor = key;

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
