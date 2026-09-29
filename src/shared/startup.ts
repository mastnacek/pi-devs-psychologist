/**
 * startup — the session_start extras that are composition-root noise, not business logic.
 *
 * Split out of `index.ts` (and to keep the composition root under the line budget): the runtime
 * flag override and the first-run welcome both run once at `session_start`, read nothing the
 * window needs, and never touch the observation surface. Both are best-effort: an invalid flag is
 * a warning, an unwritable marker is harmless repetition.
 */

import type { DevsPsychologistState } from "./state.js";
import { stringsFor } from "./i18n.js";
import { isOnboarded, markOnboarded } from "./config.js";

/** The narrowest shape of the startup context this module reads. */
export interface StartupContext {
	hasUI: boolean;
	ui: { notify(message: string, level?: "info" | "warning" | "error"): void };
}

/** The narrowest shape of the flag seam this module reads. */
export interface StartupFlags {
	getFlag(name: string): unknown;
}

/**
 * Apply the `--psych-runtime` override and the first-run welcome.
 *
 * The flag overrides the persisted runtime for THIS process only. An invalid value is ignored
 * with a notification rather than silently doing nothing, so a typo is not invisible.
 *
 * The welcome runs once per machine (the marker lives in the global config file, outside the
 * cascade): a plugin whose defaults do not say "start here" leaves the operator studying settings
 * instead of being helped. The line names the state the plugin is already in — signals live,
 * zero model spend — the ONE step that changes anything, and where the full setup help is.
 */
export function applyStartupOverrides(
	pi: StartupFlags,
	state: DevsPsychologistState,
	ctx: StartupContext,
): void {
	const runtimeFlag = pi.getFlag("psych-runtime");
	if (typeof runtimeFlag === "string" && runtimeFlag.length > 0) {
		if (runtimeFlag === "api" || runtimeFlag === "agent") {
			state.runtimeOverride = runtimeFlag;
			state.config.runtime = runtimeFlag;
		} else if (ctx.hasUI) {
			ctx.ui.notify(stringsFor(state.config.lang).runtimeFlagInvalid(runtimeFlag), "warning");
		}
	}
	if (isOnboarded(state.globalFile)) return;
	markOnboarded(state.globalFile);
	if (ctx.hasUI) {
		ctx.ui.notify(stringsFor(state.config.lang).welcomeFirstRun(state.config.model.length > 0), "info");
	}
}
