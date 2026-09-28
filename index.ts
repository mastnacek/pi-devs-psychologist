/**
 * pi-devs-psychologist — a second model watches the session as an engineering psychologist.
 *
 * Composition root ONLY: it creates the state kernel, wires slices onto Pi events, and injects
 * each slice's cross-slice dependency. No business logic lives here — and, just as important, no
 * slice reaches into another slice. What each slice owns:
 *
 * - objective session signals  → src/shared/signals + src/shared/lexicon
 * - the session's own record   → src/shared/history
 * - the appraisal contract     → src/shared/appraisal + src/shared/appraisal-enforce
 * - the model call             → src/shared/model-call
 * - config cascade             → src/shared/config + src/shared/state
 * - statusline ownership       → src/shared/status
 * - events → observation window → src/slices/observer
 * - when to appraise           → src/slices/appraiser
 * - how it is presented        → src/slices/overlay
 * - where it goes              → src/slices/interventions
 * - the `/psych` text report   → src/slices/report
 * - the `/psych` command       → src/slices/commands
 *
 * What this plugin is NOT: not a coach with opinions about code, not a score, and not an
 * authority over the working agent. It observes, it may name one intervention, and it always
 * shows the evidence it used.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { saveConfig, seedGlobalConfig } from "./src/shared/config.js";
import { readHistory } from "./src/shared/history.js";
import { stringsFor } from "./src/shared/i18n.js";
import { extractSignals } from "./src/shared/signals.js";
import { refreshModelCatalog, createDevsPsychologistState, reloadConfig, signalOptions } from "./src/shared/state.js";
import { clearChip, paintChip } from "./src/shared/status.js";
import { maybeAppraise, registerAppraiser, defaultDeps } from "./src/slices/appraiser/index.js";
import { registerPsychCommand } from "./src/slices/commands/index.js";
import { defaultInterventionDeps, deliverIntervention } from "./src/slices/interventions/index.js";
import { registerObserver } from "./src/slices/observer/index.js";
import { presentAppraisal } from "./src/slices/overlay/index.js";
import { renderReport } from "./src/slices/report/index.js";

export interface DevsPsychologistOptions {
	/**
	 * Override the global config path. The only consumer is the test suite, which must never write
	 * the operator's real `~/.pi/agent` file — the same reason `state.globalFile` exists.
	 */
	globalFile?: string;
}

export default function devsPsychologistExtension(
	pi: ExtensionAPI,
	options: DevsPsychologistOptions = {},
): void {
	// Subagent and child sessions load every global extension. An observer that watched its own
	// children would fold its own prompts into the programmer's signals and spend the session's
	// appraisal budget on noise (skill §8).
	if (process.env.PI_SUBAGENT === "true" || Boolean(process.env.PI_CHILD_SESSION)) return;

	const state = createDevsPsychologistState(pi);
	if (options.globalFile) state.globalFile = options.globalFile;

	// The one place a slice boundary is crossed: the appraiser is given the delivery policy, and
	// the delivery policy is given the card. Neither slice knows the other exists.
const appraiserDeps = defaultDeps(readHistory, (api, target, ctx, appraisal, options) =>
	deliverIntervention(
		api,
		target,
		ctx,
		appraisal,
		defaultInterventionDeps((c, a, unmatched) =>
			// The card takes one object; the delivery policy hands over the piece separately.
			presentAppraisal(c, { appraisal: a, unmatched }, target.config.lang),
		),
		// The delivery options are the LAST argument: an explicit request shows the analysis even
		// when it has no advice to give.
		options,
	),
);

	// Session init: seed the config file if it is missing (so the plugin is self-describing and
	// there is something to edit), reload the cascade — which needs a cwd that does not exist at
	// extension-load time — and start from an empty window, so a new session is never appraised
	// using an old session's events.
	state.track(
		pi.on("session_start", async (_event, ctx) => {
			const created = seedGlobalConfig(state.globalFile);
			reloadConfig(state, ctx.cwd);
			// The catalog must be cached here: the completion callback receives only the argument
			// prefix, so it cannot ask the registry itself.
			refreshModelCatalog(state, ctx.modelRegistry);
			state.resetWindow();
			paintChip(state, ctx);
			// Say it exactly once, on the run that created it. Silent seeding would leave the file
			// just as undiscoverable as no file at all.
			if (created && ctx.hasUI) {
				state.ifLive(() => ctx.ui.notify(stringsFor(state.config.lang).configSeeded(state.globalFile), "info"));
			}
		}),
	);

	registerObserver(pi, state);
	registerAppraiser(pi, state, appraiserDeps);

	registerPsychCommand(pi, state, {
		now: async (ctx) => {
			const s = stringsFor(state.config.lang);
			// `force` skips the cadence because the operator asked explicitly. It does not skip the
			// budget: a hard ceiling that yields on request is not a ceiling.
			const outcome = await maybeAppraise(pi, state, ctx, appraiserDeps, { force: true });
			// `=== false`, not `!`: truthiness narrowing is unreliable under `strict: false`, and a
			// union that silently fails to narrow is a type check that reads as passing.
			if (outcome.ran === false) {
				switch (outcome.reason) {
					case "disabled":
						return s.reportDisabled;
					case "no_model":
						return s.reportNoModel;
					case "headless":
						return s.notTui;
					case "in_flight":
						return s.busy;
					case "budget":
						return `${s.reportBudget(state.appraisalsThisSession, String(state.config.maxAppraisalsPerSession))}`;
					default:
						return s.usage;
				}
			}
			// An explicit request must show the analysis even when it has no advice: the verdicts ARE
			// the analysis, and answering a direct question with "nothing to report" makes a working
			// appraisal look like a refusal.
			if (outcome.ok === false) {
				return `${s.reportErr} — ${outcome.stage}: ${outcome.error}`;
			}
			// The card was already shown by the delivery policy when there was something to act on.
			return outcome.silent ? s.reportEmpty : s.done;
		},
		report: (ctx) => {
			// Refreshed on every invocation, so adding an OpenRouter account mid-session is picked
			// up by the next Tab press instead of needing a restart.
			refreshModelCatalog(state, ctx.modelRegistry);
			const signals = extractSignals(state.observations, signalOptions(state));
			const text = renderReport({
				state,
				signals: signals.evidence,
				history: readHistory(ctx).evidence,
				lang: state.config.lang,
			});
			if (ctx.hasUI) ctx.ui.notify(text, "info");
		},
		save: (patch, isGlobal, ctx) =>
			saveConfig(patch as never, isGlobal, ctx.cwd, state.globalFile),
		reload: (ctx) => {
			reloadConfig(state, ctx.cwd);
			paintChip(state, ctx);
		},
	});

	// Cleanup: drain listeners and release the statusline slot. Idempotent, because
	// cancellation, reload and exit can all converge here.
	pi.on("session_shutdown", async (_event, ctx) => {
		while (state.unsubscribers.length > 0) {
			try {
				state.unsubscribers.pop()?.();
			} catch {
				// ignore
			}
		}
		state.resetWindow();
		state.ifLive(() => clearChip(ctx));
	});
}
