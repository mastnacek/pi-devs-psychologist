/**
 * ask — `/psych ask <question>`: the operator consults the observer directly (T30).
 *
 * The most direct value of the agent runtime, and its simplest use: no appraisal, no triggers, no
 * verdict grid — one question, one enforced answer, one card. It shares everything that makes the
 * appraiser safe and affordable (the evidence window, the budget, the session cost cap, single
 * flight, the researching chip, `/psych stop`) without sharing its policy, so a direct question
 * cannot be mistaken for an automatic appraisal in the report or the outcome ledger.
 *
 * Dependencies are injected, exactly as in the appraiser: the model call (which runtime runs is the
 * composition root's decision, not this slice's), the session read, the card and the notification.
 * The answer is NEVER written into the working agent's context — there is no steer seam here at all.
 */

import type { ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { parseAsk, type EnforcedAsk, type SourcePolicy } from "../../shared/appraisal-enforce.js";
import type { AskCardInput } from "../../shared/ask.js";
import { effectiveAgentModel } from "../../shared/config.js";
import { environmentEvidence } from "../../shared/environment.js";
import type { SessionHistory } from "../../shared/history.js";
import { stringsFor } from "../../shared/i18n.js";
import { callModel, summarizeUsage, type ModelCallResult } from "../../shared/model-call.js";
import { allowedEvidence, ASK_SYSTEM_PROMPT, buildAskUserText } from "../../shared/prompt.js";
import { extractSignals } from "../../shared/signals.js";
import { startResearchingChip, stopResearchingChip, paintChip } from "../../shared/status.js";
import { signalOptions, type DevsPsychologistState } from "../../shared/state.js";

/** An answer is prose; the token cap is a spend guard, not a need. Same ceiling as an appraisal. */
export const ASK_MAX_TOKENS = 1200;

/** Why an `ask` did not run. Named, so "it didn't work" is never the answer. */
export type AskSkipReason = "disabled" | "headless" | "no_model" | "in_flight" | "budget" | "cost";

/** The result of a `/psych ask`. `answer` is present only on success. */
export interface AskOutcome {
	ran: boolean;
	reason?: AskSkipReason;
	ok?: boolean;
	stage?: string;
	error?: string;
	answer?: EnforcedAsk;
}

export interface AskDeps {
	/** Read the current session branch. Injected so this slice imports no other slice. */
	readHistory(ctx: ExtensionContext): SessionHistory;
	/** The one model call, whichever runtime the composition root wired. */
	callModel(
		registry: ExtensionContext["modelRegistry"],
		req: Parameters<typeof callModel>[1],
	): Promise<ModelCallResult>;
	/** Show the ask card. Returns whether it was displayed; the caller falls back to `notify`. */
	present(ctx: ExtensionContext, input: AskCardInput): Promise<boolean>;
	/** Plain fallback where a card cannot render. */
	notify(ctx: ExtensionContext, text: string): void;
	/** What a suggestion's `source` may be (T25). Absent means only URLs and install specs pass. */
	sourcePolicy?(): SourcePolicy;
}

/** True when a model resolves for the effective runtime. */
function hasModel(state: DevsPsychologistState, agentRuntime: boolean): boolean {
	return agentRuntime
		? effectiveAgentModel(state.config).trim().length > 0
		: state.config.model.trim().length > 0;
}

/** The notification fallback: the whole answer and at most ONE suggestion (T25's rule). */
function fallbackText(state: DevsPsychologistState, input: AskCardInput): string {
	const s = stringsFor(state.config.lang);
	const suggestion = input.suggestions[0];
	return suggestion
		? `${input.answer}\n${s.notifySuggestion(suggestion.text, suggestion.source)}`
		: input.answer;
}

/**
 * Ask the observer one question and present the enforced answer.
 *
 * The question always runs on the effective runtime; on `api` it becomes a tool-less completion and
 * the card says so. The budget is consumed and the session cost cap is honoured, exactly as an
 * appraisal would, and the run holds the same single-flight flag so the two can never overlap.
 */
export async function askObserver(
	state: DevsPsychologistState,
	ctx: ExtensionContext,
	deps: AskDeps,
	question: string,
): Promise<AskOutcome> {
	if (!state.config.enabled) return { ran: false, reason: "disabled" };
	if (!ctx.hasUI) return { ran: false, reason: "headless" };

	const agentRuntime = state.config.runtime === "agent";
	const modelRef = agentRuntime ? effectiveAgentModel(state.config) : state.config.model;
	if (!hasModel(state, agentRuntime)) return { ran: false, reason: "no_model" };
	// Single flight with appraisals: one observer run at a time, whichever asked for it.
	if (state.appraisalInFlight || state.appraisalPromise) return { ran: false, reason: "in_flight" };
	if (!state.budgetAvailable()) return { ran: false, reason: "budget" };
	if (agentRuntime) {
		const cap = state.config.agent.maxCostUsdPerSession;
		if (cap > 0 && state.agentSessionCostUsd >= cap) return { ran: false, reason: "cost" };
	}

	state.appraisalInFlight = true;
	state.appraisalsThisSession += 1;
	state.turnsSinceAppraisal = 0;
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

		const result = await deps.callModel(ctx.modelRegistry, {
			modelRef,
			// The agent runtime builds its own brief from `evidence`/`question` and ignores this; the
			// API runtime uses it. One request shape serves both, as for an appraisal (D1).
			systemPrompt: ASK_SYSTEM_PROMPT,
			userText: buildAskUserText(liveLines, sessionLines, question),
			maxTokens: ASK_MAX_TOKENS,
			signal: abort.signal,
			evidence: { liveLines, sessionLines },
			agentRole: "ask",
			question,
			// A direct question runs at the evidence boundary: the wider digest/fork consent levels are
			// the appraisal's, and borrowing them here would send session text no one consented to for a
			// question (D6).
			agentContext: "evidence",
		});

		if (result.ok === false) {
			return { ran: true, ok: false, stage: result.stage, error: result.error };
		}
		state.lastAppraisalUsage = summarizeUsage(result.usage);

		// The API runtime has no tools, so a research source (a docs path, an nlm notebook) cannot be real:
		// only a URL or an install spec survives. The agent runtime uses the machine's real policy (T25).
		const parsed = parseAsk(result.text, lines, agentRuntime ? deps.sourcePolicy?.() : undefined);
		if (parsed.ok === false) {
			return { ran: true, ok: false, stage: "parse", error: parsed.error };
		}
		const enforced = parsed.answer;
		const input: AskCardInput = {
			question,
			answer: enforced.answer,
			cited: enforced.cited,
			suggestions: enforced.suggestions,
			unsupported: enforced.unsupported,
			noResearch: !agentRuntime,
		};

		let shown = false;
		try {
			shown = await deps.present(ctx, input);
		} catch {
			shown = false;
		}
		if (!shown) {
			try {
				deps.notify(ctx, fallbackText(state, input));
			} catch {
				// A dead UI must not fail the command.
			}
		}
		return { ran: true, ok: true, answer: enforced };
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
 * Wrap `askObserver` as the `/psych` command's `ask` handler: it maps a skip or failure onto the one
 * status line `/psych` notifies, and returns `""` on success because the answer was already shown as
 * a card (or as the notification fallback). Lives here so the composition root adds no policy.
 */
export function askCommandHandler(
	state: DevsPsychologistState,
	deps: AskDeps,
): (ctx: ExtensionCommandContext, question: string) => Promise<string> {
	return async (ctx, question) => {
		const s = stringsFor(state.config.lang);
		const outcome = await askObserver(state, ctx, deps, question);
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
