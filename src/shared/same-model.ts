/**
 * same-model — the one fact that decides whether the observer IS an observer.
 *
 * An observer sharing the working model's blind spots is not a second opinion; the README says so,
 * and this makes it visible in the chip and `/psych` instead of leaving it as advice nobody checked.
 * No behaviour change and no extra spend: it only reads two model references and compares them.
 *
 * The working reference comes from the session (`ctx.model`, captured at session start); the
 * observer reference is the one the effective runtime would actually call. When the session does not
 * expose its model (headless, or a context without one) there is nothing to compare, so the warning
 * is simply absent — never a guess.
 */

import { effectiveAgentModel } from "./config.js";
import type { DevsPsychologistState } from "./state.js";

/** `provider/id` for a registry model, or `""` when the value is not a usable reference. */
export function modelRefOf(model: { provider?: unknown; id?: unknown } | undefined): string {
	if (!model) return "";
	const provider = model.provider;
	const id = model.id;
	if (typeof provider !== "string" || typeof id !== "string") return "";
	if (provider.length === 0 || id.length === 0) return "";
	return `${provider}/${id}`;
}

/** The reference the observer model would actually be called with, for the effective runtime. */
export function observerModelRef(state: DevsPsychologistState): string {
	return (state.config.runtime === "agent" ? effectiveAgentModel(state.config) : state.config.model).trim();
}

/** True only when the session exposed a model and it is exactly the observer's. */
export function sameModelWarning(state: DevsPsychologistState): boolean {
	return state.sessionModelRef.length > 0 && state.sessionModelRef === observerModelRef(state);
}
