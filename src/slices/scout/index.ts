/**
 * scout — `/psych scout [topic]` and the automatic recurring-friction scout (T31).
 *
 * The scout answers one question the workshop rule asks before any building: does the pi ecosystem
 * already solve this friction? It runs on the agent runtime only — it needs tools (pi list, web,
 * npm, GitHub) and the operator's own plugin monorepo — and behind its own consent gate
 * (`roles.scout.enabled`, default off), because a run costs money.
 *
 * It mirrors the `ask` slice: injected dependencies, the same evidence window, the same budget,
 * session cost cap, single-flight flag, researching chip and `/psych stop`. Two things are
 * different. It refuses outright on the API runtime (unlike `ask`, which falls back), and it can be
 * started by the appraiser as the trigger for a recurring failure at count ≥ 3, in which case the
 * appraiser has already consumed the budget and moved the trigger baseline — `fromTrigger` skips
 * those two steps so the work is not done twice.
 *
 * Nothing here reaches the working agent: there is no steer seam at all.
 */

import type { ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { effectiveAgentModel } from "../../shared/config.js";
import { environmentEvidence } from "../../shared/environment.js";
import type { SessionHistory } from "../../shared/history.js";
import { stringsFor } from "../../shared/i18n.js";
import { callModel, summarizeUsage, type ModelCallResult } from "../../shared/model-call.js";
import { allowedEvidence, buildScoutUserText, SCOUT_SYSTEM_PROMPT } from "../../shared/prompt.js";
import { parseScout, type EnforcedScout } from "../../shared/scout-enforce.js";
import { projectName, topRecurringTopic, type ScoutCardInput } from "../../shared/scout.js";
export { SCOUT_TRIGGER_MIN_COUNT } from "../../shared/scout.js";
import { extractSignals } from "../../shared/signals.js";
import { paintChip, startResearchingChip, stopResearchingChip } from "../../shared/status.js";
import { signalOptions, type DevsPsychologistState } from "../../shared/state.js";

/** A candidate list is a small JSON object; the cap is a spend guard, not a need. */
export const SCOUT_MAX_TOKENS = 1200;

/** Why a scout did not run. Named, so "it didn't work" is never the answer. */
export type ScoutSkipReason = "disabled" | "runtime" | "headless" | "no_model" | "in_flight" | "budget" | "cost";

/** The result of a scout run. `scout` is present only on success. */
export interface ScoutOutcome {
	ran: boolean;
	reason?: ScoutSkipReason;
	ok?: boolean;
	stage?: string;
	error?: string;
	scout?: EnforcedScout;
}

export interface ScoutDeps {
	/** Read the current session branch. Injected so this slice imports no other slice. */
	readHistory(ctx: ExtensionContext): SessionHistory;
	/** The one model call, whichever runtime the composition root wired. */
	callModel(
		registry: ExtensionContext["modelRegistry"],
		req: Parameters<typeof callModel>[1],
	): Promise<ModelCallResult>;
	/** Show the scout card. Returns whether it was displayed; the caller falls back to `notify`. */
	present(ctx: ExtensionContext, input: ScoutCardInput): Promise<boolean>;
	/** Plain fallback where a card cannot render. */
	notify(ctx: ExtensionContext, text: string): void;
}

/** The notification fallback: the top candidate, else the SPAI idea line, else "nothing found". */
function fallbackText(state: DevsPsychologistState, input: ScoutCardInput): string {
	const s = stringsFor(state.config.lang);
	const first = input.candidates[0];
	if (first) {
		return s.notifyScoutCandidate(first.name, s.labels.scoutFits[first.fit], first.why, first.installSpec, first.url);
	}
	if (input.ideaLine) return input.ideaLine;
	return s.scoutNothingFound;
}

/**
 * Run the scout and present the enforced answer.
 *
 * `fromTrigger` marks the automatic path: the appraiser has already consumed the budget, moved the
 * trigger baseline and set the single-flight flag, so this skips those steps rather than duplicating
 * them. Everything that costs or shows is still done here, on the shared chip and abort handle.
 */
export async function scoutObserver(
	state: DevsPsychologistState,
	ctx: ExtensionContext,
	deps: ScoutDeps,
	topic: string,
	options: { fromTrigger?: boolean } = {},
): Promise<ScoutOutcome> {
	const fromTrigger = options.fromTrigger === true;
	if (!state.config.enabled || !state.config.roles.scout.enabled) return { ran: false, reason: "disabled" };
	// The scout never runs on the API runtime: no tools means no research, and a recalled package is
	// exactly the fabrication the role exists to avoid (unlike `ask`, which offers a tool-less answer).
	if (state.config.runtime !== "agent") return { ran: false, reason: "runtime" };
	if (!ctx.hasUI) return { ran: false, reason: "headless" };
	const modelRef = effectiveAgentModel(state.config);
	if (modelRef.trim().length === 0) return { ran: false, reason: "no_model" };
	if (!fromTrigger) {
		if (state.appraisalInFlight || state.appraisalPromise) return { ran: false, reason: "in_flight" };
		if (!state.budgetAvailable()) return { ran: false, reason: "budget" };
		const cap = state.config.agent.maxCostUsdPerSession;
		if (cap > 0 && state.agentSessionCostUsd >= cap) return { ran: false, reason: "cost" };
		state.appraisalsThisSession += 1;
		state.turnsSinceAppraisal = 0;
	}

	state.appraisalInFlight = true;
	startResearchingChip(state, ctx);

	const abort = new AbortController();
	state.appraisalAbort = abort;
	const ctxSignal = ctx.signal;
	const forwardAbort = () => abort.abort();
	if (ctxSignal) {
		if (ctxSignal.aborted) abort.abort();
		else ctxSignal.addEventListener("abort", forwardAbort, { once: true });
	}

	try {
		const signals = extractSignals(state.observations, signalOptions(state));
		const history = deps.readHistory(ctx);
		const sessionLines = [
			...history.evidence,
			...(state.config.envFacts ? environmentEvidence({ cwd: ctx.cwd }) : []),
		];
		const liveLines = [...signals.evidence];
		const lines = allowedEvidence(liveLines, sessionLines);
		const project = projectName(ctx.cwd);

		const result = await deps.callModel(ctx.modelRegistry, {
			modelRef,
			// The agent runtime builds its own brief from `evidence`/`topic`; the API runtime never
			// reaches this call, so this is a well-formed safety net rather than a live path.
			systemPrompt: SCOUT_SYSTEM_PROMPT,
			userText: buildScoutUserText(liveLines, sessionLines, topic),
			maxTokens: SCOUT_MAX_TOKENS,
			signal: abort.signal,
			evidence: { liveLines, sessionLines },
			agentRole: "scout",
			topic,
			agentContext: "evidence",
		});

		if (result.ok === false) return { ran: true, ok: false, stage: result.stage, error: result.error };
		state.lastAppraisalUsage = summarizeUsage(result.usage);

		const parsed = parseScout(result.text, lines, project);
		if (parsed.ok === false) return { ran: true, ok: false, stage: "parse", error: parsed.error };
		const scout = parsed.scout;
		const trimmed = topic.trim();
		const input: ScoutCardInput = {
			topic: trimmed.length > 0 ? trimmed : undefined,
			candidates: scout.candidates,
			build: scout.build,
			ideaLine: scout.ideaLine,
			cited: scout.cited,
			nothingFound: scout.nothingFound,
		};

		let shown = false;
		try {
			shown = await deps.present(ctx, input);
		} catch {
			shown = false;
		}
		if (!shown) {
			// "Nothing found" on an automatic run stays silent: the operator asked nothing, and a
			// notification about an absence is the nag this plugin exists to avoid. An operator run
			// always says so.
			if (!(input.nothingFound && fromTrigger)) {
				try {
					deps.notify(ctx, fallbackText(state, input));
				} catch {
					// A dead UI must not fail the command.
				}
			}
		}
		return { ran: true, ok: true, scout };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { ran: true, ok: false, stage: "request", error: message };
	} finally {
		state.appraisalInFlight = false;
		if (state.appraisalAbort === abort) state.appraisalAbort = undefined;
		ctxSignal?.removeEventListener?.("abort", forwardAbort);
		stopResearchingChip(state);
		state.ifLive(() => paintChip(state, ctx));
	}
}

/**
 * The automatic trigger's entry point (T31), wired by the composition root into the appraiser.
 *
 * The topic defaults to the top recurring fingerprint when the operator gave none; with none to
 * derive from, the operator run says so with the usage line instead of scouting an empty topic.
 */
export function scoutCommandHandler(
	state: DevsPsychologistState,
	deps: ScoutDeps,
): (ctx: ExtensionCommandContext, topic: string) => Promise<string> {
	return async (ctx, topicArg) => {
		const s = stringsFor(state.config.lang);
		let topic = (topicArg ?? "").trim();
		if (topic.length === 0) {
			const signals = extractSignals(state.observations, signalOptions(state));
			const pick = topRecurringTopic(signals.failureFingerprints, 1);
			if (!pick) return s.usage;
			topic = pick.topic;
		}
		const outcome = await scoutObserver(state, ctx, deps, topic);
		if (outcome.ran === false) {
			switch (outcome.reason) {
				case "disabled":
					return s.scoutDisabled;
				case "runtime":
					return s.scoutNeedsAgent;
				case "no_model":
					return s.reportNoModel;
				case "headless":
					return s.notTui;
				case "in_flight":
					return s.busy;
				case "budget":
					return s.reportBudget(state.appraisalsThisSession, String(state.config.maxAppraisalsPerSession));
				case "cost":
					return s.reportCostCap;
				default:
					return s.usage;
			}
		}
		if (outcome.ok === false) return `${s.reportErr} — ${outcome.stage}: ${outcome.error}`;
		return "";
	};
}

/**
 * The appraiser's trigger seam (T31): run the scout for a recurring fingerprint.
 *
 * `fromTrigger` is always true here — the appraiser owns the budget and the once-per-session guard.
 * The returned outcome is not consumed; the appraiser has already decided this turn is a scout turn.
 */
export async function runScoutTrigger(
	state: DevsPsychologistState,
	ctx: ExtensionContext,
	deps: ScoutDeps,
	topic: string,
): Promise<void> {
	await scoutObserver(state, ctx, deps, topic, { fromTrigger: true });
}