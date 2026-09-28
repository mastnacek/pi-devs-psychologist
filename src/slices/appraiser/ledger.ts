/**
 * appraiser/ledger — the outcome ledger (T16), split out of the policy file by concept.
 *
 * The appraiser decides *when* the model runs; this decides what a delivered intervention means to
 * the ledger, and closes the windows whose `outcomeWindowTurns` have elapsed. Keeping it here (not
 * in `shared/outcome.ts`) is deliberate: that module is pure arithmetic over the ledger, while this
 * one talks to `pi.appendEntry` and needs the injected history read.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Appraisal } from "../../shared/appraisal.js";
import type { DeliveryOutcome } from "../../shared/delivery.js";
import type { SessionHistory } from "../../shared/history.js";
import {
	resolveDueOutcomes,
	snapshotOutcome,
	type OutcomeChannel,
	type OutcomeRecord,
} from "../../shared/outcome.js";
import { extractSignals, type SessionSignals } from "../../shared/signals.js";
import { signalOptions, type DevsPsychologistState } from "../../shared/state.js";
import type { AppraiserDeps } from "./types.js";

/** A unique id for a ledger record. `randomUUID` where available; a time+counter fallback otherwise. */
export function nextOutcomeId(): string {
	const api = globalThis.crypto as { randomUUID?: () => string } | undefined;
	if (typeof api?.randomUUID === "function") return api.randomUUID();
	return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Record a delivered intervention in the ledger and persist it as a TUI-only entry (T16).
 *
 * Only a delivery the operator actually saw is recorded: a silent appraisal, or one whose
 * intervention T17 dropped, wrote nothing to measure. The channel names the surface, and the
 * card's open duration is measured around the `deliver` await the caller wrapped.
 */
export function recordDelivery(
	pi: ExtensionAPI,
	state: DevsPsychologistState,
	signals: SessionSignals,
	history: SessionHistory,
	intervention: Appraisal["interventions"][number] | undefined,
	delivery: DeliveryOutcome,
	cardOpenedAt: number,
): void {
	if (!intervention) return;
	const channel: OutcomeChannel | undefined =
		delivery.human === "card"
			? "card"
			: delivery.human === "notification"
				? "notification"
				: delivery.agent
					? "steer"
					: undefined;
	if (!channel) return;
	const record: OutcomeRecord = {
		id: nextOutcomeId(),
		kind: intervention.kind,
		deliveredAtTurn: state.turnCount,
		channel,
		before: snapshotOutcome({ signals, history }),
		text: intervention.text,
		...(channel === "card" ? { closedCardMs: Math.max(0, Date.now() - cardOpenedAt) } : {}),
	};
	state.outcomes.push(record);
	pi.appendEntry("psych-outcome", record);
}

/**
 * Close every outcome window whose `outcomeWindowTurns` have elapsed (T16).
 *
 * Runs on every turn (regardless of whether an appraisal ran), recomputing the session snapshot
 * once and applying it to every due record. A record that just closed is persisted as its own
 * follow-up entry, so a reload reconstructs the verdict.
 */
export function settleOutcomes(
	pi: ExtensionAPI,
	state: DevsPsychologistState,
	ctx: ExtensionContext,
	deps: AppraiserDeps,
): void {
	if (state.outcomes.length === 0) return;
	const signals = extractSignals(state.observations, signalOptions(state));
	const snapshot = snapshotOutcome({ signals, history: deps.readHistory(ctx) });
	for (const record of resolveDueOutcomes(
		state.outcomes,
		state.turnCount,
		state.config.outcomeWindowTurns,
		snapshot,
	)) {
		pi.appendEntry("psych-outcome", record);
	}
}