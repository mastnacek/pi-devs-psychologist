/**
 * history-evidence — rendering the session history as the factual lines a model may
 * read.
 *
 * Split from `history.ts` because it is a different job: that file *reads* entries and
 * produces numbers, this one turns numbers into text. They change for different
 * reasons — a new entry type touches the fold, a wording change touches this — and the
 * discipline they share is the reason to keep them adjacent rather than merged into
 * some generic formatter.
 *
 * The rule, identical to `describeSignals`: counts and names only, never conclusions.
 * These lines are the sole history text that reaches the appraiser, so every later
 * claim must be traceable to one of them.
 */

import type { SessionHistory } from "./history.js";

/** Whole seconds, the unit a wait is actually felt in. */
function seconds(ms: number): number {
	return Math.round(ms / 1000);
}

export function describeHistory(history: SessionHistory): string[] {
	const lines: string[] = [];
	if (history.windowMs > 0) {
		lines.push(`session span: ${Math.round(history.windowMs / 60000)} min`);
	}
	if (history.declaredIntent) {
		lines.push(`operator declared this session as: "${history.declaredIntent}"`);
	}
	if (history.abortedTurns > 0) {
		lines.push(`turns the operator cancelled: ${history.abortedTurns}`);
	}
	if (history.errorTurns > 0) {
		lines.push(`turns ending in a provider error: ${history.errorTurns}`);
	}
	if (history.truncatedTurns > 0) {
		lines.push(`turns cut off by the output limit: ${history.truncatedTurns}`);
	}
	if (history.modelSwitches > 0) {
		lines.push(`model switched ${history.modelSwitches} time(s), ending on: ${history.modelsUsed.join(" -> ")}`);
	}
	if (history.thinkingRaises > 0) {
		lines.push(`thinking level raised by the operator: ${history.thinkingRaises}`);
	}
	if (history.thinkingLowers > 0) {
		lines.push(`thinking level lowered by the operator: ${history.thinkingLowers}`);
	}
	if (history.compactions > 0) {
		lines.push(
			`context compacted: ${history.compactions} time(s), largest ${history.peakTokensBeforeCompaction} tokens (engine-decided: ${history.engineCompactions})`,
		);
	}
	if (history.abandonedBranches > 0) {
		lines.push(`approaches abandoned via /tree: ${history.abandonedBranches}`);
	}
	if (history.contextRemovals > 0) {
		lines.push(`earlier entries removed from model context: ${history.contextRemovals}`);
	}
	if (history.contextReplacements > 0) {
		lines.push(`earlier entries rewritten in model context: ${history.contextReplacements}`);
	}
	if (history.userCheckpoints.length > 0) {
		lines.push(
			`operator bookmarks still set: ${history.userCheckpoints.length} (${history.userCheckpoints.join(", ")})`,
		);
	}
	if (history.longestHumanWaitMs > 0) {
		lines.push(
			`wait for the agent: median ${seconds(history.medianHumanWaitMs)} s, longest ${seconds(history.longestHumanWaitMs)} s`,
		);
	}
	if (history.cacheHitRate !== undefined) {
		lines.push(`prompt-cache read share: ${Math.round(history.cacheHitRate * 100)}%`);
	}
	return lines;
}
