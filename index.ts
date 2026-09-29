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

import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { saveConfig, seedGlobalConfig } from "./src/shared/config.js";
import { createAgentCall, type AgentCall } from "./src/shared/agent-call.js";
import { type AgentRunIo } from "./src/shared/agent-runner.js";
import { callModel } from "./src/shared/model-call.js";
import { resolvePiDocsDir } from "./src/shared/pi-paths.js";
import { readHistory } from "./src/shared/history.js";
import { noteFollowed, noteQuickWin, restoreOutcomes } from "./src/shared/outcome.js";
import { stringsFor } from "./src/shared/i18n.js";
import { extractSignals } from "./src/shared/signals.js";
import { refreshModelCatalog, createDevsPsychologistState, reloadConfig, restoreAppraisal, signalOptions, type DevsPsychologistState } from "./src/shared/state.js";
import { clearChip, paintChip, stopResearchingChip } from "./src/shared/status.js";
import { parseChildLimits, parseChildRole } from "./src/shared/child-limits.js";
import {
	maybeAppraise,
	registerAppraiser,
	defaultDeps,
	abortAppraisal,
	stopAppraisal,
	type AppraiserDeps,
	type AppraiseOutcome,
} from "./src/slices/appraiser/index.js";
import { registerChildSlice } from "./src/slices/child/index.js";
import { registerPsychCommand } from "./src/slices/commands/index.js";
import { askCommandHandler, type AskDeps } from "./src/slices/ask/index.js";
import { runScoutTrigger, scoutCommandHandler, type ScoutDeps } from "./src/slices/scout/index.js";
import { reviewCommandHandler, runReviewTrigger, type ReviewDeps } from "./src/slices/reviewer/index.js";
import { resolveGitHead } from "./src/shared/review.js";
import { defaultInterventionDeps, deliverIntervention, notifyUnverifiedCommit } from "./src/slices/interventions/index.js";
import { registerObserver } from "./src/slices/observer/index.js";
import { presentAppraisal, presentAsk, presentReview, presentScout } from "./src/slices/overlay/index.js";
import { repoMapEvidenceLines, repoMapReport } from "./src/slices/mapper/index.js";
import { renderReport, renderEffect } from "./src/slices/report/index.js";

export interface DevsPsychologistOptions {
	/**
	 * Override the global config path. The only consumer is the test suite, which must never write
	 * the operator's real `~/.pi/agent` file — the same reason `state.globalFile` exists.
	 */
	globalFile?: string;
	/**
	 * Test seam for the agent runtime (T24): the process surface `runAgent` uses. The suite must never
	 * spawn a real child pi, so it injects a fake whose "child" is scripted; production leaves it
	 * unset and `defaultAgentRunIo()` is used. The rest of the agent path (cost cap, state) stays real.
	 */
	agentIo?: AgentRunIo;
	/**
	 * Test seam for the researching chip's interval (T26). Production leaves it unset and the global
	 * clock is used; the suite injects a fake so no real timer exists and shutdown is observable.
	 */
	timerIo?: DevsPsychologistState["timers"];
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
	if (options.timerIo) state.timers = options.timerIo;

	// The one place a slice boundary is crossed: the appraiser is given the delivery policy, and
	// the delivery policy is given the card. Neither slice knows the other exists.
	const deliver: AppraiserDeps["deliver"] = (api, target, ctx, appraisal, options) =>
		deliverIntervention(
			api,
			target,
			ctx,
			appraisal,
			defaultInterventionDeps((c, a, unmatched, staleTurns) =>
				// The card takes one object; the delivery policy hands the pieces over separately. `staleTurns`
				// is present only when the run's window has moved on (T26).
				presentAppraisal(c, { appraisal: a, unmatched, ...(staleTurns ? { staleTurns } : {}) }, target.config.lang),
			),
			// The delivery options are the LAST argument: an explicit request shows the analysis even
			// when it has no advice to give.
			options,
		);

	// The runtime switch (T24). `callModel` is the seam the appraiser was built around (D1): the API
	// call by default, the child-pi runner when `runtime: "agent"` (effective, including the
	// `--psych-runtime` override, which is applied to the in-memory config at session_start). The
	// branch is read at CALL time so a `/psych runtime` switch takes effect without a reload.
	const apiCallModel: AppraiserDeps["callModel"] = (registry, req) => callModel(registry, req);

	// The child's engine entry and docs dir, resolved once (T24). Never a shell, never `pi.cmd`: the
	// node binary runs the engine's own cli.js (spike Q1).
	const cliPath =
		process.argv[1] ??
		(process.env.PI_PACKAGE_DIR
			? join(process.env.PI_PACKAGE_DIR, "dist", "bundle", "cli.js")
			: "");
	const docsDir = resolvePiDocsDir({
		argv1: process.argv[1],
		packageDir: process.env.PI_PACKAGE_DIR,
		exists: existsSync,
	});

	// The agent-runtime call (T24), lifted into a shared factory so this root stays a wiring file. The
	// role and question come from the request (T30): an appraisal runs as `psychologist`, `/psych ask`
	// sets `"ask"`. It owns the session cost cap and keeps the running child's kill handle in state.
	const agentCallModel: AgentCall = createAgentCall(state, { cliPath, docsDir, ...(options.agentIo ? { io: options.agentIo } : {}) });

	const callModelDep: AppraiserDeps["callModel"] = (registry, req) =>
		state.config.runtime !== "agent" ? apiCallModel(registry, req) : agentCallModel(registry, req);

	const appraiserDeps = defaultDeps(readHistory, deliver, callModelDep, () => ({
		// Resolved by this root (never by the slice), read live so a config edit that adds a notebook
		// takes effect without a restart. Sources are judged in `appraisal-enforce.ts` (T25).
		docsDir,
		nlmNotebooks: state.config.agent.nlmNotebooks,
	}));

	// `/psych ask` (T30): the same seams as the appraiser (so a direct question shares the budget, the
	// session cost cap and single flight), plus the ask card and the plain-notification fallback.
	const askDeps: AskDeps = {
		readHistory,
		callModel: callModelDep,
		present: (ctx, input) => presentAsk(ctx, input, state.config.lang),
		notify: (ctx, text) => {
			if (ctx.hasUI) ctx.ui.notify(text, "info");
		},
		sourcePolicy: () => ({ docsDir, nlmNotebooks: state.config.agent.nlmNotebooks }),
	};

	// `/psych scout` (T31): the same seams again, plus the scout card. The scout is agent-runtime
	// only, behind its own consent gate, and it can also be started by the appraiser's trigger below.
	const scoutDeps: ScoutDeps = {
		readHistory,
		callModel: callModelDep,
		present: (ctx, input) => presentScout(ctx, input, state.config.lang),
		notify: (ctx, text) => {
			if (ctx.hasUI) ctx.ui.notify(text, "info");
		},
	};

	// The scout trigger (T31): reaches the scout slice without the appraiser importing it. The
	// appraiser has already consumed the budget and moved the baseline before this is called.
	appraiserDeps.runScout = (ctx, topic) => runScoutTrigger(state, ctx, scoutDeps, topic);

	// `/psych review` (T32a): the reviewer role's own consent gate, its own model, and the delivery
	// boundary as its trigger. It reads the diff itself; the parent retains nothing about the change.
	const reviewDeps: ReviewDeps = {
		readHistory,
		callModel: callModelDep,
		present: (ctx, input) => presentReview(ctx, input, state.config.lang),
		notify: (ctx, text) => {
			if (ctx.hasUI) ctx.ui.notify(text, "info");
		},
		resolveHead: resolveGitHead,
	};

	// The repo map (T8): the appraiser asks for citable SESSION lines, the mapper slice owns the
	// walk and the once-per-session cache. Injected, so neither slice imports the other.
	appraiserDeps.repoMap = (target, cwd) => repoMapEvidenceLines(target, cwd);

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
			// Facts the agent runtime needs at spawn time, captured here where a real context exists: the
			// call seam is `(registry, req)`, so a later turn has no context to read them from (T24).
			state.sessionCwd = ctx.cwd;
			state.agentTrusted =
				typeof ctx.isProjectTrusted === "function" ? ctx.isProjectTrusted() : false;
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
		// The delivery boundary (T32a): a successful commit/push or a `/label` bookmark starts a
		// review. Fire-and-forget, single-flighted, and never in the way of the delivery itself.
		onDeliveryBoundary: (ctx) => runReviewTrigger(state, ctx, reviewDeps),
	});
	registerAppraiser(pi, state, appraiserDeps);

	registerPsychCommand(pi, state, {
		now: async (ctx) => {
			const s = stringsFor(state.config.lang);
			// The operator waits, so if an automatic appraisal is already running we wait on THAT
			// promise rather than starting a second (T26). Otherwise run a forced one: `force` skips the
			// cadence because the operator asked explicitly, but never the budget.
			const outcome: AppraiseOutcome = state.appraisalPromise
				? await state.appraisalPromise
				: await maybeAppraise(pi, state, ctx, appraiserDeps, { force: true });
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
					case "cost":
						return s.reportCostCap;
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
		stop: () => {
			// The operator asked to stop; `/psych stop` (T26) kills the run and says so. `stopAppraisal`
			// returns whether anything was running, so "nothing to stop" is never a false claim.
			const s = stringsFor(state.config.lang);
			return stopAppraisal(state, s.stopReason) ? s.stopRequested : s.stopNothing;
		},
				report: (ctx) => {
			// Refreshed on every invocation, so adding an OpenRouter account mid-session is picked
			// up by the next Tab press instead of needing a restart.
			refreshModelCatalog(state, ctx.modelRegistry);
			const signals = extractSignals(state.observations, signalOptions(state));
			// Width comes from the terminal so the report truncates rather than wraps (T27).
			const columns = process.stdout?.columns ?? 0;
			// The repo map (T8) is cached, so rendering the report never re-walks the tree; the age is
			// surfaced so an old number is not read as a current one.
			const map = repoMapReport(state, ctx.cwd);
			const text = renderReport({
				state,
				signals: signals.evidence,
				history: readHistory(ctx).evidence,
				lang: state.config.lang,
				mapLines: map.lines,
				mapUnavailable: map.unavailable,
				mapAgeTurns: map.ageTurns,
				...(columns > 0 ? { width: columns } : {}),
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
		// The ask slice owns the mapping from a skip/failure to the status line; this root only wires it.
		ask: askCommandHandler(state, askDeps),
		// The scout slice owns the same mapping for /psych scout (T31).
		scout: scoutCommandHandler(state, scoutDeps),
		// The reviewer slice owns it for /psych review (T32a).
		review: reviewCommandHandler(state, reviewDeps),
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
		// Stop a running run first: kill the child, abort the call, drop a held result and clear the
		// researching chip's timer (T24, T26). `abortAppraisal` is idempotent, so a run that already
		// finished leaves this a no-op. `stopResearchingChip` clears the timer even with no run.
		abortAppraisal(state);
		stopResearchingChip(state);
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
