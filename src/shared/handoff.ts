/**
 * handoff — the factual ledger written at `session_shutdown`, offered at the next `session_start`.
 *
 * Zero tokens and zero model: it is arithmetic over what the session already recorded. The shape is
 * deliberately narrow — counts and one last failure fingerprint — because PRD §5 forbids scores,
 * mood words and any claim about the person. It is stored as a TUI-only session entry (never a file,
 * never a message) and replayed on the next start as one notification line, never on shutdown.
 */

import { isVerificationCommand, MUTATION_TOOLS } from "./lexicon.js";
import { mutationsSinceVerified, type Observation, type SessionSignals } from "./signals.js";

/** The TUI-only entry the ledger is written to. */
export const HANDOFF_ENTRY = "psych-handoff";
/** The TUI-only marker recording that the ledger was already offered, so it is offered once. */
export const HANDOFF_NOTIFIED_ENTRY = "psych-handoff-notified";

/** How many unverified file paths the ledger names — a headline, not a full change list (idea 5). */
export const UNVERIFIED_FILES_CAP = 3;

/** The ledger left by a session that ran. Counts only; no score, no person-level claim. */
export interface HandoffLedger {
	/** Mutations since the last verified run — the change set that never proved itself. */
	unverifiedMutations: number;
	/**
	 * Up to `UNVERIFIED_FILES_CAP` repo-relative paths mutated since the last verified run, highest
	 * successful-mutation count first. The file NAME is a fact about the work, not about the person;
	 * an empty array when nothing is unverified. See `unverifiedFilesSinceVerified`.
	 */
	unverifiedFiles: string[];
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

/**
 * Up to `cap` repo-relative paths mutated since the last successful verification run, highest
 * successful-mutation count first, ties alphabetical.
 *
 * Only SUCCESSFUL mutations of a mutation tool count: a failed `edit` changed nothing (`ok` is
 * false), and a file touched before the run was proven. This is the named fold of the same
 * observation window `mutationsSinceVerified` counts, so the number and the names cannot disagree.
 */
export function unverifiedFilesSinceVerified(
	log: readonly Observation[],
	cap: number = UNVERIFIED_FILES_CAP,
): string[] {
	let lastVerifiedIndex = -1;
	log.forEach((item, index) => {
		if (item.kind === "tool" && item.ok && isVerificationCommand(item.command)) lastVerifiedIndex = index;
	});
	const counts = new Map<string, number>();
	for (let i = lastVerifiedIndex + 1; i < log.length; i += 1) {
		const item = log[i];
		if (item.kind !== "tool" || !item.ok) continue;
		if (!MUTATION_TOOLS.has(item.toolName)) continue;
		if (typeof item.path !== "string" || item.path.length === 0) continue;
		counts.set(item.path, (counts.get(item.path) ?? 0) + 1);
	}
	return [...counts.entries()]
		.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
		.slice(0, cap)
		.map(([path]) => path);
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
		unverifiedFiles: unverifiedFilesSinceVerified(input.observations),
		...(lastFailure ? { lastFailure } : {}),
		bookmarks: input.bookmarks,
		openLoops: input.openLoops,
		toolCalls: input.signals.toolCalls,
		failures: input.signals.toolFailures,
	};
}
