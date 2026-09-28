/**
 * signals-evidence — rendering the signal fold as the factual lines a model may read.
 *
 * Split out of `signals.ts` for the same reason `history.ts` was split: a wording change
 * touches only this file, and a new signal touches only the fold. The lines are the only text
 * that crosses into the appraiser's prompt, so they stay counts and names, never conclusions.
 *
 * Imports `SessionSignals` as a type only, so there is no runtime cycle with `signals.ts`.
 */

import type { SessionSignals } from "./signals.js";

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
	// One line per signature, however many times it happened. Four `edit` failures that share
	// a cause are one fact, and printing them four times would make a single problem look like
	// four — which is how an observer talks a programmer out of fixing the real one.
	for (const fingerprint of signals.failureFingerprints.slice(0, 5)) {
		lines.push(`${fingerprint.toolName} failed ${fingerprint.count}x — ${fingerprint.signature}`);
	}
	// Recurrence, promoted to its own kind of line: "the same thing keeps failing" is a different
	// fact from "a thing failed N times", and it is the one worth naming. Highest count first, at
	// most three, so a noisy session cannot bury the rest of the evidence.
	for (const fingerprint of signals.failureFingerprints.filter((f) => f.count >= 2).slice(0, 3)) {
		lines.push(
			`recurring failure: ${fingerprint.toolName} · ${fingerprint.signature} ×${fingerprint.count}`,
		);
	}
	// Delivery boundary (T15): a commit shipped a change set no run ever proved. Purely factual —
	// the count is the file changes pending at the most recent such commit.
	if (signals.unverifiedCommits > 0) {
		lines.push(`commit after ${signals.unverifiedCommitChanges} file change(s) with no verified run since`);
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
