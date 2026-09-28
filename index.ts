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
 * In CHILD mode (T22) none of that is wired: this package becomes a read-only guard plus the single
 * `psych_submit` tool — src/slices/child. See the branch at the top of the factory.
 *
 * What this plugin is NOT: not a coach with opinions about code, not a score, and not an
 * authority over the working agent. It observes, it may name one intervention, and it always
 * shows the evidence it used.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { saveConfig, seedGlobalConfig } from "./src/shared/config.js";
import { readHistory } from "./src/shared/history.js";
import { noteFollowed, noteQuickWin, restoreOutcomes } from "./src/shared/outcome.js";
import { stringsFor } from "./src/shared/i18n.js";
import { extractSignals } from "./src/shared/signals.js";
import { refreshModelCatalog, createDevsPsychologistState, reloadConfig, restoreAppraisal, signalOptions } from "./src/shared/state.js";
import { clearChip, paintChip } from "./src/shared/status.js";
import { parseChildLimits, parseChildRole } from "./src/shared/child-limits.js";
import { maybeAppraise, registerAppraiser, defaultDeps } from "./src/slices/appraiser/index.js";
import { registerChildSlice } from "./src/slices/child/index.js";
import { registerPsychCommand } from "./src/slices/commands/index.js";
import { defaultInterventionDeps, deliverIntervention, notifyUnverifiedCommit } from "./src/slices/interventions/index.js";
import { registerObserver } from "./src/slices/observer/index.js";
import { presentAppraisal } from "./src/slices/overlay/index.js";
import { renderReport, renderEffect } from "./src/slices/report/index.js";

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
	// Child mode (T22, D3/D4): this process is the headless child our own agent runtime spawned. The
	// same package must NOT wire the observer, the appraiser, any command or the chip here — only the
	// read-only guard and the one submission tool. Checked BEFORE the subagent guard below because the
	// child deliberately carries neither PI_SUBAGENT nor PI_CHILD_SESSION (D5 keeps the other workshop
	// plugins on), so without this branch it would fall straight through into parent mode and start
	// observing its own one-shot session. The limits come from the environment, and a malformed value
	// fails closed: ten tool calls and no capability (src/shared/child-limits.ts).
	if (process.env.PI_DEVS_PSYCH_CHILD === "1") {
		registerChildSlice(pi, parseChildRole(process.env.PI_DEVS_PSYCH_ROLE), parseChildLimits(process.env.PI_DEVS_PSYCH_LIMITS));
		return;
	}

	// Subagent and child sessions load every global extension. An observer that watched its own
	// children would fold its own prompts into the programmer's signals and spend the session's
	// appraisal budget on noise (skill §8).
	if (process.env.PI_SUBAGENT === "true" || Boolean(process.env.PI_CHILD_SESSION)) return;

	// This process's runtime override, never written to disk: `--psych-runtime agent|api`. Consent for
	// session context is deliberately NOT settable here — a one-run flag must never carry a persisted
	// decision (T21). Read back at session_start; the value is applied to the in-memory config only.
	pi.registerFlag("psych-runtime", {
		description: "Override the psychologist runtime for this run (api|agent)",
		type: "string",
	});

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
			// The runtime flag overrides the persisted runtime for THIS process only. An invalid value is
			// ignored with a notification rather than silently doing nothing, so a typo is not invisible.
			const runtimeFlag = pi.getFlag("psych-runtime");
			if (typeof runtimeFlag === "string" && runtimeFlag.length > 0) {
				if (runtimeFlag === "api" || runtimeFlag === "agent") {
					state.runtimeOverride = runtimeFlag;
					state.config.runtime = runtimeFlag;
				} else if (ctx.hasUI) {
					ctx.ui.notify(stringsFor(state.config.lang).runtimeFlagInvalid(runtimeFlag), "warning");
				}
			}
			// The catalog must be cached here: the completion callback receives only the argument
			// prefix, so it cannot ask the registry itself.
			refreshModelCatalog(state, ctx.modelRegistry);
			state.resetWindow();
			// Restore the TUI-only ledger and the last appraisal (T7/T16). `getEntries` returns the whole
			// session, so a reload - or a branch switch - brings back the outcome numbers and the report
			// instead of starting blind. Neither the entries nor their text ever enter the observation
			// window: restoring a judgement as an event would corrupt every prompt-counting signal.
			const entries = ctx.sessionManager.getEntries();
			restoreAppraisal(state, entries);
			state.outcomes = restoreOutcomes(entries);
			// Keep the outcome clock sane across a reload: a restored delivery must not read as
			// "negative turns ago", so the turn counter resumes at least where the ledger left it.
			state.turnCount = state.outcomes.reduce((max, record) => Math.max(max, record.deliveredAtTurn), state.turnCount);
			paintChip(state, ctx);
			// Say it exactly once, on the run that created it. Silent seeding would leave the file
			// just as undiscoverable as no file at all.
			if (created && ctx.hasUI) {
				state.ifLive(() => ctx.ui.notify(stringsFor(state.config.lang).configSeeded(state.globalFile), "info"));
			}
		}),
	);

	registerObserver(pi, state, {
		// The commit check's notification text comes from the delivery slice; the observer only
		// records the fact. The composition root is the only place that knows both.
		notifyUnverifiedCommit: (ctx, count) => notifyUnverifiedCommit(ctx, state.config.lang, count),
		// Ledger reactions (T16): the observer forwards the raw prompt and tool name, the pure ledger
		// decides whether either follows an intervention. The observer stays outcome-free.
		outcome: {
			notePrompt: (text) => noteFollowed(state.outcomes, text),
			noteToolCall: (toolName) => noteQuickWin(state.outcomes, toolName),
		},
	});
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
		effect: (ctx) => {
			// The outcome table is width-safe and session-scoped only (full cross-session ledger is T10).
			const columns = ctx.hasUI ? (process.stdout?.columns ?? 0) : 0;
			const text = renderEffect({
				ledger: state.outcomes,
				lang: state.config.lang,
				width: columns > 0 ? columns : 100,
			});
			if (ctx.hasUI) ctx.ui.notify(text, "info");
		},
		save: (patch, isGlobal, ctx) => {
			// An explicit runtime choice supersedes the one-run flag; any other setting keeps it.
			if (patch && typeof patch === "object" && "runtime" in patch) state.runtimeOverride = undefined;
			return saveConfig(patch as never, isGlobal, ctx.cwd, state.globalFile);
		},
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
