/**
 * interventions — the delivery policy: at most one intervention, to the human, and to the
 * agent only if explicitly asked.
 *
 * Two surfaces, deliberately separate:
 *
 * - **The human surface** is the card, or a plain notification where a card cannot render
 *   (RPC, or `mode !== "tui"`), or nothing at all. One line of advice, never a list.
 * - **The agent surface** is off by default (`steerAgent`). Writing into the working agent's
 *   context makes this plugin an authority over the worker, and ADR 0001 decided it may not
 *   be one unless asked. When it is on, the text is prefixed so the agent knows it comes from
 *   an observer rather than from the operator.
 *
 * Steering from inside `turn_end` is safe: the appraiser resets its cadence when it attempts,
 * so the turn this triggers cannot immediately re-trigger an appraisal. Without that reset the
 * two features would form a loop, which is why the reset is on the *attempt* and not the
 * success.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isSilent } from "../../shared/appraisal-enforce.js";
import type { Appraisal } from "../../shared/appraisal.js";
import type { Intervention } from "../../shared/appraisal.js";
import { steerText } from "../../shared/prompt.js";
import type { DevsPsychologistState } from "../../shared/state.js";

// Re-exported so a caller can name the outcome without reaching into `shared/`; the
// definition lives there because the appraiser slice carries it too.
export type { DeliveryOutcome, HumanDelivery } from "../../shared/delivery.js";
import type { DeliveryOutcome, HumanDelivery } from "../../shared/delivery.js";

export interface InterventionDeps {
	/** Show the card. Returns whether it was displayed. */
	present(ctx: ExtensionContext, appraisal: Appraisal, unmatched: string[]): Promise<boolean>;
	/** Plain fallback where a card cannot render. */
	notify(ctx: ExtensionContext, text: string): void;
	/** Write one advisory line into the working agent's context. */
	steer(pi: ExtensionAPI, ctx: ExtensionContext, text: string): void;
}

/**
 * Deliver whatever the appraisal deserves — which may be nothing.
 *
 * Silence is the normal outcome: an empty intervention list is a valid appraisal, and the
 * plugin's stated preference is silence over a weak observation.
 */
export async function deliverIntervention(
	pi: ExtensionAPI,
	state: DevsPsychologistState,
	ctx: ExtensionContext,
	appraisal: Appraisal,
	deps: InterventionDeps,
): Promise<DeliveryOutcome> {
	const intervention: Intervention | undefined = appraisal.interventions[0];
	if (!intervention || isSilent(appraisal)) {
		return { human: "none", agent: false, reason: "silent" };
	}

	let human: HumanDelivery = "none";
	if (ctx.hasUI) {
		const unmatched = state.lastAppraisalNotes?.unmatched ?? [];
		// A showing failure must degrade to the notification ladder, not lose the intervention: an
		// overlay that cannot draw and a plugin that says nothing look identical from outside.
		let shown = false;
		try {
			shown = await deps.present(ctx, appraisal, unmatched);
		} catch {
			shown = false;
		}
		human = shown ? "card" : "notification";
		if (!shown) {
			try {
				deps.notify(ctx, intervention.text);
			} catch {
				// A dead UI must not fail the turn.
			}
		}
	} else {
		return { human: "none", agent: false, reason: "no_ui" };
	}

	let agent = false;
	if (state.config.steerAgent) {
		try {
			deps.steer(pi, ctx, intervention.text);
			agent = true;
		} catch {
			// Steering is best-effort: the operator has already seen the card.
		}
	}

	return { human, agent };
}

/**
 * Subscribe nothing; the appraiser calls this. It exists as a factory so the composition root
 * is the only place that knows about `pi.sendUserMessage`.
 */
export function defaultInterventionDeps(
	present: InterventionDeps["present"],
): InterventionDeps {
	return {
		present,
		notify: (ctx, text) => {
			if (!ctx.hasUI) return;
			ctx.ui.notify(text, "info");
		},
		steer: (pi, ctx, text) => {
			const body = steerText(text);
			// Idle: it starts a turn now. Streaming: queued as a follow-up, never injected
			// mid-stream, so the observer cannot cut the worker off halfway through.
			if (ctx.isIdle()) pi.sendUserMessage(body);
			else pi.sendUserMessage(body, { deliverAs: "followUp" });
		},
	};
}