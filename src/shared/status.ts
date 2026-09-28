/**
 * Statusline painting — the plugin owns exactly one slot and one owner of its
 * text, so the observer and the appraiser never fight over the chip.
 *
 * What the chip shows is chosen by one rule: it must be a fact the user can act
 * on. Never a score, never a streak, never a mood. Three states exist because
 * three are actionable — off, observing without a model, and observing with one.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { effectiveAgentModel } from "./config.js";
import { stringsFor } from "./i18n.js";
import type { DevsPsychologistState } from "./state.js";

export const STATUS_ID = "devs-psychologist";

/** Write the shared slot; a dead session or missing UI is not an error. */
export function setStatus(ctx: ExtensionContext, text: string | undefined): void {
	if (!ctx.hasUI) return;
	try {
		ctx.ui.setStatus(STATUS_ID, text);
	} catch {
		// Session closed or UI unavailable.
	}
}

/**
 * The chip. `psych: signals` makes the no-model state visible, because silent and
 * unconfigured look identical from the outside; `psych n/s` is the appraisal budget
 * being spent. `psych: off` is the one state the user must never have to ask about.
 *
 * Every string comes from the locale table (`config.lang`). Hardcoding them here was
 * a defect: `lang` was validated, persisted and then ignored.
 */
/** Failure stages only the operator can fix. A transient one must not light up the chip. */
const CONFIG_STAGES = new Set(["config", "resolve", "auth"]);

export function paintChip(state: DevsPsychologistState, ctx: ExtensionContext): void {
	const strings = stringsFor(state.config.lang);
	if (!state.config.enabled) {
		setStatus(ctx, strings.chipOff);
		return;
	}
	// `runtime: "agent"` resolves its model from `agent.model` first, so the "no model" question is
	// asked of the effective model, not of the shared `model` alone. With no model either way the
	// agent runtime is observation-only, and the chip has to say so rather than look configured.
	if (state.config.runtime === "agent") {
		if (effectiveAgentModel(state.config).length === 0) {
			setStatus(ctx, strings.chipAgentNoModel);
			return;
		}
	} else if (state.config.model.length === 0) {
		setStatus(ctx, strings.chipSignals);
		return;
	}

	// A model that cannot be resolved or has no credentials is a configuration problem only
	// the operator can fix, so it earns a persistent chip. Transient failures — a provider
	// error, a timeout — must not shout: they are not actionable and they pass.
	if (state.lastAppraisalFailure && CONFIG_STAGES.has(state.lastAppraisalFailure.stage)) {
		setStatus(ctx, strings.chipConfigError);
		return;
	}
	const cap = state.config.maxAppraisalsPerSession;
	const used = state.appraisalsThisSession;
	const budget = cap === 0 ? `${used}` : `${used}/${cap}`;
	// Turns since the last appraisal is the one number that explains silence:
	// the observer is waiting for its cadence, not dead.
	const waiting = state.appraisalInFlight ? "…" : `${state.turnsSinceAppraisal}t`;
	setStatus(ctx, strings.chipAppraisal(waiting, budget));
}

/** Clear the slot. Idempotent; called from session_shutdown. */
export function clearChip(ctx: ExtensionContext): void {
	setStatus(ctx, undefined);
}