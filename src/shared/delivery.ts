/**
 * delivery — the contract for handing an intervention to a surface.
 *
 * In `shared/` because two slices need the same vocabulary and slices may not import each other:
 * the interventions slice produces an outcome, the appraiser carries it in its result. Defining it
 * once here is what lets either be tested without the other.
 *
 * `human` names *how* the operator saw it rather than *that* it was sent, because "we called
 * notify" and "the operator saw it" are different claims and only the second one matters.
 */

/** How the operator saw an intervention. */
export type HumanDelivery = "card" | "notification" | "none";

export interface DeliveryOutcome {
	/** The operator's surface, if any. */
	human: HumanDelivery;
	/** Whether it was written into the working agent's context (`steerAgent`). */
	agent: boolean;
	/** Why nothing was delivered, when nothing was. */
	reason?: "silent" | "no_ui";
}