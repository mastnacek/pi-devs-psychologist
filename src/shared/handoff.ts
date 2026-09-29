/**
 * handoff — the factual ledger written at `session_shutdown`, offered at the next `session_start`.
 *
 * Zero tokens and zero model: it is arithmetic over what the session already recorded. The shape is
 * deliberately narrow — counts and one last failure fingerprint — because PRD §5 forbids scores,
 * mood words and any claim about the person. It is stored as a TUI-only session entry (never a file,
 * never a message) and replayed on the next start as one notification line, never on shutdown.
 */

import { mutationsSinceVerified, type Observation, type SessionSignals } from "./signals.js";

/** The TUI-only entry the ledger is written to. */
export const HANDOFF_ENTRY = "psych-handoff";
/** The TUI-only marker recording that the ledger was already offered, so it is offered once. */
export const HANDOFF_NOTIFIED_ENTRY = "psych-handoff-notified";

/** The ledger left by a session that ran. Counts only; no score, no person-level claim. */
export interface HandoffLedger {
	/** Mutations since the last verified run — the change set that never proved itself. */
	unverifiedMutations: number;
	/** The last failing tool and its failure signature, or absent when nothing failed. */
	lastFailure?: { tool: string; signature: string };
	/** `/label` bookmarks still set at the end of the session. */
	bookmarks: number;
	/** Delivered interventions whose outcome window never closed. */
	openLoops: number;
	/** Tool calls and their failures over the session's retained window. */
	toolCalls: number;
	failures: number;
}

/** Fold the session's own facts into the handoff ledger. Pure: nothing here touches the engine. */
export function buildHandoffLedger(input: {
	observations: readonly Observation[];
	signals: SessionSignals;
	bookmarks: number;
	openLoops: number;
}): HandoffLedger {
	let lastFailure: HandoffLedger["lastFailure"];
	for (const observation of input.observations) {
		if (observation.kind !== "tool") continue;
		if (observation.ok !== false) continue;
		// The last one wins, so the line names the most recent reason the session stopped working.
		lastFailure = { tool: observation.toolName, signature: observation.errorSignature ?? "" };
	}
	return {
		unverifiedMutations: mutationsSinceVerified(input.observations),
		...(lastFailure ? { lastFailure } : {}),
		bookmarks: input.bookmarks,
		openLoops: input.openLoops,
		toolCalls: input.signals.toolCalls,
		failures: input.signals.toolFailures,
	};
}
