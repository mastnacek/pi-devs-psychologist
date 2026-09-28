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
import { stringsFor, type Locale } from "../../shared/i18n.js";
import { steerText } from "../../shared/prompt.js";
import type { DevsPsychologistState } from "../../shared/state.js";

// Re-exported so a caller can name the outcome without reaching into `shared/`; the
// definition lives there because the appraiser slice carries it too.
export type { DeliveryOutcome, HumanDelivery } from "../../shared/delivery.js";
import type { DeliveryOutcome, HumanDelivery } from "../../shared/delivery.js";

export interface DeliveryOptions {
	/**
	 * Show the appraisal even when it carries no intervention.
	 *
	 * Silence is the right default for an appraisal the plugin decided to run, and the wrong
	 * answer to an operator who asked for one: the verdicts ARE the analysis, and hiding them
	 * behind a "nothing to report" status line makes a working appraisal look like a refusal.
	 */
	evenIfSilent?: boolean;
	/**
	 * Turns between the run's start and this delivery (T26). Passed to the card so a slow run can
	 * say its window has moved on; omitted when the gap is not worth naming.
	 */
	staleTurns?: number;
}

export interface InterventionDeps {
	/** Show the card. Returns whether it was displayed. `staleTurns` feeds the card's header (T26). */
	present(
		ctx: ExtensionContext,
		appraisal: Appraisal,
		unmatched: string[],
		staleTurns?: number,
	): Promise<boolean>;
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
	options: DeliveryOptions = {},
): Promise<DeliveryOutcome> {
	const intervention: Intervention | undefined = appraisal.interventions[0];
	// Researched suggestions (T25) are worth a card on their own: they cost a tool-using run, and
	// holding them back until an intervention happens to appear would throw that spend away.
	const hasSuggestions = (appraisal.suggestions?.length ?? 0) > 0;
	const nothingToShow = (!intervention && !hasSuggestions) || (isSilent(appraisal) && !hasSuggestions);
	if (nothingToShow && options.evenIfSilent !== true) {
		return { human: "none", agent: false, reason: "silent" };
	}

	let human: HumanDelivery = "none";
	if (ctx.hasUI) {
		const unmatched = state.lastAppraisalNotes?.unmatched ?? [];
		// A showing failure must degrade to the notification ladder, not lose the intervention: an
		// overlay that cannot draw and a plugin that says nothing look identical from outside.
		let shown = false;
		try {
			shown = await deps.present(ctx, appraisal, unmatched, options.staleTurns);
		} catch {
			shown = false;
		}
		human = shown ? "card" : "notification";
		if (!shown) {
			try {
				const s = stringsFor(state.config.lang);
				// At most ONE suggestion in the fallback, so the notification stays one thing to read; the
				// rest wait for the card. Suggestions are never part of the agent steer below.
				const suggestion = appraisal.suggestions?.[0];
				const base = intervention ? intervention.text : s.cardNothingToAct;
				deps.notify(ctx, suggestion ? `${base}\n${s.notifySuggestion(suggestion.text, suggestion.source)}` : base);
			} catch {
				// A dead UI must not fail the turn.
			}
		}
	} else {
		return { human: "none", agent: false, reason: "no_ui" };
	}

	let agent = false;
	// Only an intervention may steer; suggestions are operator-only and a suggestions-only card has
	// nothing for the agent.
	if (state.config.steerAgent && intervention) {
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

/**
 * Deliver the delivery-boundary notification (T15). One line, to the human only — never a card,
 * never steering into the working agent's context (D8). Ui copy from the locale table.
 */
export function notifyUnverifiedCommit(ctx: ExtensionContext, lang: Locale, count: number): void {
	if (!ctx.hasUI) return;
	ctx.ui.notify(stringsFor(lang).commitUnverified(count), "info");
}