/**
 * replay/render — the width-safe text `/psych replay` and `/psych replay --eval` print.
 *
 * Two rules shape every line here, and both are the product:
 * - **Counts and verdicts, never a message body.** The reader reconstructs an observation window;
 *   the transcript it came from is NOT shown. A window prints its trigger reasons, how many evidence
 *   lines it supplied, what enforcement did, and the MODEL's own answer — never the operator's
 *   prompt text.
 * - **Width-safe.** Every line is clipped with `truncateToWidth`, so a narrow terminal truncates
 *   rather than crashing the host process (a `pi-tui` hard-crash, not a cosmetic issue).
 */

import { stringsFor, type Locale } from "../../shared/i18n.js";
import type { ReplayEval } from "../../shared/replay-eval.js";
import { measureWindow, type ReplayRunResult } from "../../shared/replay-eval.js";
import type { ReplayWindow } from "../../shared/replay-windows.js";
import { truncateToWidth } from "@earendil-works/pi-tui";

export interface ReplayReportInput {
	sessionFile: string;
	mode: "dry" | "run";
	modelRef: string;
	windows: readonly ReplayWindow[];
	results: readonly ReplayRunResult[];
	/** Windows whose model call failed, so a partial run says so instead of hiding them. */
	failures: number;
	lang: Locale;
	width: number;
}

const MARK = "·";

/** One padded cell, plain ASCII so `padEnd` measures like the terminal does. */
function column(value: string, width: number, right = false): string {
	const clipped = value.length > width ? value.slice(0, width) : value;
	return right ? clipped.padStart(width) : clipped.padEnd(width);
}

/** Clip every line to `width`; `0` means "no clipping" (a test, or a headless call). */
function clip(lines: string[], width: number): string {
	if (width <= 0) return lines.join("\n");
	return lines.map((line) => truncateToWidth(line, width, "…")).join("\n");
}

/** Render the per-window replay report. */
export function renderReplay(input: ReplayReportInput): string {
	const s = stringsFor(input.lang);
	const lines: string[] = [
		s.replayTitle,
		s.replayHeader(input.windows.length, input.mode),
	];
	if (input.mode === "run") lines.push(s.replayModel(input.modelRef));
	if (input.failures > 0) lines.push(s.replayFailures(input.failures));
	if (input.windows.length === 0) lines.push("", s.replayNoWindows);

	for (const window of input.windows) {
		const result = input.results.find((item) => item.windowIndex === window.index);
		lines.push("", s.replayWindow(window.index + 1));
		lines.push(
			`  ${window.triggerReasons.length > 0 ? s.replayTrigger(window.triggerReasons.join(", ")) : s.replayNoTrigger}`,
		);
		lines.push(`  ${s.replayEvidence(window.liveLines.length, window.sessionLines.length)}`);
		if (result) {
			const metrics = measureWindow(result);
			const kind = metrics.interventionKind ?? s.replayInterventionNone;
			lines.push(`  ${s.replayEnforcement(metrics.verdictsKept, metrics.claimsDropped, kind)}`);
			if (result.responseText.length > 0) lines.push(`  ${s.replayResponse} ${MARK} ${result.responseText}`);
		}
	}
	return clip(lines, input.width);
}

/** Render the two-run eval table. Pure arithmetic over the two result files. */
export function renderEval(input: { eval: ReplayEval; beforeFile: string; afterFile: string; lang: Locale; width: number }): string {
	const s = stringsFor(input.lang);
	const lines: string[] = [s.replayEvalTitle, s.replayEvalHeader(input.eval.windows.length)];

	const label = 26;
	const num = 12;
	lines.push("");
	lines.push(
		column(s.replayEvalColumns.metric, label) +
			column(s.replayEvalColumns.before, num, true) +
			column(s.replayEvalColumns.after, num, true),
	);
	const row = (name: string, before: string, after: string) =>
		column(name, label) + column(before, num, true) + column(after, num, true);
	lines.push(row(s.replayMetrics.verdictsKept, String(input.eval.before.verdictsKept), String(input.eval.after.verdictsKept)));
	lines.push(row(s.replayMetrics.claimsDropped, String(input.eval.before.claimsDropped), String(input.eval.after.claimsDropped)));
	lines.push(row(s.replayMetrics.citationRate, input.eval.before.citationRate.toFixed(2), input.eval.after.citationRate.toFixed(2)));
	lines.push(row(s.replayMetrics.precision, input.eval.before.precision.toFixed(2), input.eval.after.precision.toFixed(2)));
	lines.push(row(s.replayMetrics.abstentionRate, input.eval.before.abstentionRate.toFixed(2), input.eval.after.abstentionRate.toFixed(2)));
	lines.push(row(s.replayMetrics.meanCitations, input.eval.before.meanCitationsPerFinding.toFixed(2), input.eval.after.meanCitationsPerFinding.toFixed(2)));

	for (const window of input.eval.windows) {
		const before = window.kindBefore ?? s.replayInterventionNone;
		const after = window.kindAfter ?? s.replayInterventionNone;
		lines.push(
			"",
			window.changed
				? s.replayWindowChange(window.windowIndex + 1, before, after)
				: s.replayWindowUnchanged(window.windowIndex + 1, after),
		);
	}
	return clip(lines, input.width);
}
