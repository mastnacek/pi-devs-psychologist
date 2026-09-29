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
import { modelRefOf, sameModelWarning } from "./same-model.js";
import type { DevsPsychologistState } from "./state.js";

export const STATUS_ID = "devs-psychologist";

/** How often the researching chip repaints. At most once per second, per T26. */
export const RESEARCHING_TICK_MS = 1000;

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
	// Capture the working model here rather than in the factory: a context that exposes one is the
	// only place it is knowable, and a context that does not must leave the previous value alone.
	if (ctx.model !== undefined) state.sessionModelRef = modelRefOf(ctx.model);
	// The chip is one short line, so the same-model disclosure is a suffix (the full sentence lives in
	// `/psych`). It applies to every configured state; the no-model states cannot have a match.
	const paint = (text: string): void =>
		setStatus(ctx, sameModelWarning(state) ? `${text} · ${strings.chipSameModel}` : text);
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

	// A run in flight is the one state where the operator must see progress rather than wait:
	// an agent run takes tens of seconds. The elapsed count comes from the injected clock, and
	// the tool count is present only on the agent runtime (the API call has no tools to count).
	if (state.appraisalStartedAt !== undefined) {
		const seconds = Math.max(0, Math.round((state.timers.now() - state.appraisalStartedAt) / 1000));
		paint(
			state.config.runtime === "agent"
				? strings.chipResearchingTools(`${seconds}s`, String(state.appraisalToolCalls))
				: strings.chipResearching(`${seconds}s`),
		);
		return;
	}

	// A model that cannot be resolved or has no credentials is a configuration problem only
	// the operator can fix, so it earns a persistent chip. Transient failures — a provider
	// error, a timeout — must not shout: they are not actionable and they pass.
	if (state.lastAppraisalFailure && CONFIG_STAGES.has(state.lastAppraisalFailure.stage)) {
		paint(strings.chipConfigError);
		return;
	}
	const cap = state.config.maxAppraisalsPerSession;
	const used = state.appraisalsThisSession;
	const budget = cap === 0 ? `${used}` : `${used}/${cap}`;
	// Turns since the last appraisal is the one number that explains silence:
	// the observer is waiting for its cadence, not dead.
	const waiting = state.appraisalInFlight ? "…" : `${state.turnsSinceAppraisal}t`;
	setStatus(
		ctx,
		state.appraisalInFlight
			? `${strings.chipAppraisal("…", budget)}${sameModelWarning(state) ? ` · ${strings.chipSameModel}` : ""}`
			: state.config.runtime === "agent"
			? `${strings.chipAppraisal(waiting, budget)}${sameModelWarning(state) ? ` · ${strings.chipSameModel}` : ""}`
			: `${strings.chipAppraisal(waiting, budget)}${sameModelWarning(state) ? ` · ${strings.chipSameModel}` : ""}`,
	);
}

/** Clear the slot. Idempotent; called from session_shutdown. */
export function clearChip(ctx: ExtensionContext): void {
	setStatus(ctx, undefined);
}

/**
 * Start the researching chip: record the start and repaint at most once per second until the run
 * ends. The timer is started here rather than in the factory because a run is a session-scoped
 * event, and it is injectable so no test owns a real interval.
 */
export function startResearchingChip(state: DevsPsychologistState, ctx: ExtensionContext): void {
	state.appraisalStartedAt = state.timers.now();
	state.appraisalToolCalls = 0;
	if (state.chipTimer !== undefined) return;
	state.chipTimer = state.timers.setInterval(() => {
		state.ifLive(() => paintChip(state, ctx));
	}, RESEARCHING_TICK_MS);
}

/**
 * Stop the researching chip and clear its progress. Idempotent, and called from the appraisal's
 * `finally` AND from `session_shutdown`, because a run can end either way.
 */
export function stopResearchingChip(state: DevsPsychologistState): void {
	if (state.chipTimer !== undefined) {
		state.timers.clearInterval(state.chipTimer);
		state.chipTimer = undefined;
	}
	state.appraisalStartedAt = undefined;
	state.appraisalToolCalls = 0;
}
