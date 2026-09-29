/**
 * handoff slice — writes the zero-token session ledger at shutdown and offers it at the next start.
 *
 * The two halves are deliberately apart in time: the ledger is written when the session ends (never
 * shown then — shutdown is not a place to talk to anyone), and offered as one line at the start of
 * the next session, once. Both surfaces are TUI-only (`pi.appendEntry`), so the ledger never enters
 * model context and is never a file or a message.
 *
 * The slice imports only `src/shared/`, so it can be tested without the composition root.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	buildHandoffLedger,
	HANDOFF_ENTRY,
	HANDOFF_NOTIFIED_ENTRY,
	type HandoffLedger,
} from "../../shared/handoff.js";
import type { SessionHistory } from "../../shared/history.js";
import { previousLedger } from "../../shared/handoff-previous.js";
import { stringsFor } from "../../shared/i18n.js";
import { extractSignals } from "../../shared/signals.js";
import { signalOptions, type DevsPsychologistState } from "../../shared/state.js";

/** Cross-slice dependency: the session record, read by the composition root's injected reader. */
export interface HandoffDeps {
	readHistory(ctx: ExtensionContext): SessionHistory;
}

function isCustom(entry: { type?: string; customType?: string } | undefined, customType: string): boolean {
	return entry?.type === "custom" && entry.customType === customType;
}

/** The structural view of a session entry this slice needs (type, customType, data). */
type EntryView = { type?: string; customType?: string; data?: unknown };

/** Wire the shutdown write and the next-start offer. */
export function registerHandoff(pi: ExtensionAPI, state: DevsPsychologistState, deps: HandoffDeps): void {
	state.track(
		pi.on("session_shutdown", (_event, ctx) => {
			if (!state.config.handoff) return;
			// A session that never appraised has nothing to hand off: the plugin did not run, so a
			// ledger would be a claim about a session it never observed.
			if (state.appraisalsThisSession === 0) return;
			const history = deps.readHistory(ctx);
			const signals = extractSignals(state.observations, signalOptions(state));
			const ledger = buildHandoffLedger({
				observations: state.observations,
				signals,
				bookmarks: history.userCheckpoints.length,
				// Open loops are deliveries whose outcome window never closed.
				openLoops: state.outcomes.filter((record) => record.verdicts === undefined).length,
			});
			pi.appendEntry(HANDOFF_ENTRY, ledger);
		}),
	);

	state.track(
		pi.on("session_start", (_event, ctx) => {
			if (!state.config.handoff) return;
			const entries = ctx.sessionManager.getEntries() as readonly EntryView[];
			// Offered at most once: the marker entry is written with the offer, so a reload or a
			// resumed session does not repeat it.
			if (entries.some((entry) => isCustom(entry, HANDOFF_NOTIFIED_ENTRY))) return;
			// A `/reload` or `--continue` still carries this session's own entries, so they are read
			// first. A NEW session has its own file and never sees them, which is what the live run
			// proved; the previous session's file is where a handoff actually lives.
			const own = [...entries].reverse().find((entry) => isCustom(entry, HANDOFF_ENTRY));
			const ledger = own
				? (own.data as HandoffLedger | null | undefined) ?? undefined
				: previousLedger(ctx.sessionManager.getSessionDir(), ctx.sessionManager.getSessionFile());
			if (ledger === undefined || ledger === null || typeof ledger !== "object") return;
			pi.appendEntry(HANDOFF_NOTIFIED_ENTRY, {});
			if (ctx.hasUI) {
				ctx.ui.notify(
					stringsFor(state.config.lang).handoffNotify(
						ledger.unverifiedMutations,
						ledger.openLoops,
						ledger.bookmarks,
						ledger.failures,
					),
					"info",
				);
			}
		}),
	);
}
