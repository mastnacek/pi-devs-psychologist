/**
 * flow-shield — the plugin practising what it preaches (idea 6).
 *
 * While this session's delivered intervention is `protect_flow` and it has not yet been resolved,
 * the plugin holds its OWN cards and notifications. It is the one moment when the advice is "do not
 * interrupt the operator", and the plugin would be the first thing to violate it.
 *
 * Held items are queued in order and released on the next `agent_end` while the shield is still up;
 * when the shield clears first (the outcome resolved) the queue is dropped, never replayed. The chip
 * is untouched: it is one short line, not an interruption. Nothing here touches other plugins.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { stringsFor } from "./i18n.js";
import type { DevsPsychologistState } from "./state.js";

/** Recompute the shield from the ledger: on while a `protect_flow` intervention is unresolved. */
export function refreshFlowShield(state: DevsPsychologistState): void {
	state.flowShield =
		state.config.flowShield &&
		state.outcomes.some((record) => record.kind === "protect_flow" && record.verdicts === undefined);
}

/** True while the shield is up. Reads the cached flag, so callers pay nothing per delivery. */
export function flowShieldActive(state: DevsPsychologistState): boolean {
	return state.flowShield;
}

/**
 * Present a card, or queue it when the shield is up.
 *
 * Returns `true` while shielded so the caller does NOT fall back to a notification: the card is
 * held, and its queued closure will present it for real at the next pause. A `false` here would make
 * the caller notify, which is itself held, and the operator would see a notification instead of the
 * card. The queued closure calls the raw presenter, so flushing is never re-guarded.
 */
export function guardPresentation(
	state: DevsPsychologistState,
	present: () => Promise<boolean>,
): Promise<boolean> {
	if (!state.flowShield) return present();
	state.flowShieldQueue.push(async () => {
		try {
			await present();
		} catch {
			// A dead UI at flush time must not fail the turn.
		}
	});
	return Promise.resolve(true);
}

/** Notify, or queue it when the shield is up. The queued closure is the raw notify. */
export function guardNotification(state: DevsPsychologistState, notify: () => void): void {
	if (!state.flowShield) {
		notify();
		return;
	}
	state.flowShieldQueue.push(async () => {
		try {
			notify();
		} catch {
			// A dead UI at flush time must not fail the turn.
		}
	});
}

/**
 * Release the held items at a pause, in order, while the shield is still up.
 *
 * The queue is taken and reset first, so a `notify` emitted during the flush cannot re-enter it.
 * When the shield has cleared, the queue is dropped — the items are dropped, not queued.
 */
export async function flushFlowShield(state: DevsPsychologistState, ctx: ExtensionContext): Promise<void> {
	const held = state.flowShieldQueue;
	state.flowShieldQueue = [];
	if (!state.flowShield || held.length === 0) return;
	for (const item of held) await item();
	if (ctx.hasUI) {
		try {
			ctx.ui.notify(stringsFor(state.config.lang).flowShieldReleased(held.length), "info");
		} catch {
			// A dead UI must not fail the turn.
		}
	}
}
