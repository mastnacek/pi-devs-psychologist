/**
 * reviewer — `/psych review` and the delivery-boundary review (`reviewer` role, T32a).
 *
 * The reviewer is NOT a second auditor. It is one run on the already-proven agent seams: trigger =
 * the delivery boundary (a successful commit/push, a `/label` bookmark, or the operator's command),
 * child = the existing agent runtime with its own, stronger model, input = the diff since the last
 * delivery read by the CHILD itself (the parent retains nothing about the change — ADR 0001) plus
 * the repo's stated conventions, output = at most one finding class, or `insufficient_context`.
 *
 * It mirrors the `ask`/`scout` slices: injected dependencies, the same evidence window, budget,
 * session cost cap, single-flight flag, researching chip and `/psych stop`. Two things are its own:
 * it is agent-runtime only (a tool-less model cannot read a diff), and it tracks the commit head so a
 * delivery is reviewed at most once and consecutive commits review the range since the last review.
 *
 * Nothing here reaches the working agent: there is no steer seam at all (ADR 0001 invariant 7).
 */

import type { ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ReviewBrief } from "../../shared/agent-brief.js";
import { parseReview, type EnforcedReview } from "../../shared/appraisal-enforce.js";
import { effectiveAgentModel } from "../../shared/config.js";
import { environmentEvidence } from "../../shared/environment.js";
import type { SessionHistory } from "../../shared/history.js";
import { stringsFor } from "../../shared/i18n.js";
import { callModel, summarizeUsage, type ModelCallResult } from "../../shared/model-call.js";
import { buildReviewUserText, REVIEW_SYSTEM_PROMPT } from "../../shared/prompt.js";
import { isAbstention, type ReviewCardInput } from "../../shared/review.js";
import { extractSignals } from "../../shared/signals.js";
import { paintChip, startResearchingChip, stopResearchingChip } from "../../shared/status.js";
import { signalOptions, type DevsPsychologistState } from "../../shared/state.js";

/** A finding is a small JSON object; the cap is a spend guard, not a need. */
export const REVIEW_MAX_TOKENS = 1200;

/** Why a review did not run. Named, so "it didn't work" is never the answer. */
export type ReviewSkipReason =
	| "disabled"
	| "runtime"
	| "headless"
	| "no_model"
	| "no_git"
	| "already"
	| "in_flight"
	| "budget"
	| "cost";

/** The result of a review run. `review` is present only on success. */
export interface ReviewOutcome {
	ran: boolean;
	reason?: ReviewSkipReason;
	ok?: boolean;
	stage?: string;
	error?: string;
	review?: EnforcedReview;
	head?: string;
}

export interface ReviewDeps {
	/** Read the current session branch. Injected so this slice imports no other slice. */
	readHistory(ctx: ExtensionContext): SessionHistory;
	/** The one model call, whichever runtime the composition root wired. */
	callModel(
		registry: ExtensionContext["modelRegistry"],
		req: Parameters<typeof callModel>[1],
	): Promise<ModelCallResult>;
	/** Show the review card. Returns whether it was displayed; the caller falls back to `notify`. */
	present(ctx: ExtensionContext, input: ReviewCardInput): Promise<boolean>;
	/** Plain fallback where a card cannot render. */
	notify(ctx: ExtensionContext, text: string): void;
	/** The current git HEAD for `cwd`, or `""` when it is not a repository. Injected for tests. */
	resolveHead(cwd: string): string;
}

/** The complete reviewer consent gate: its own switch, the agent runtime, and a resolvable model. */
function reviewerModel(state: DevsPsychologistState): string {
	const own = state.config.roles.reviewer.model.trim();
	return own.length > 0 ? own : effectiveAgentModel(state.config);
}

/** The working agent's model reference, or `undefined` when the session does not expose one. */
function workingModel(ctx: ExtensionContext): string | undefined {
	const model = ctx.model;
	if (!model) return undefined;
	const provider = model.provider;
	const id = model.id;
	return typeof provider === "string" && typeof id === "string" ? `${provider}/${id}` : undefined;
}

/** The notification fallback: the one finding in a sentence, or the abstention's reason. */
function fallbackText(state: DevsPsychologistState, input: ReviewCardInput): string {
	const s = stringsFor(state.config.lang);
	const finding = input.finding;
	if (!finding || isAbstention(finding)) {
		return `${s.reviewDeclined} ${finding?.text ?? ""}`.trim();
	}
	return `${s.labels.reviewVerdicts[finding.verdict]}: ${finding.file} — ${finding.text}`;
}

/**
 * Run one review and present the enforced finding.
 *
 * `force` (the operator's `/psych review`) ignores the once-per-delivery rule but never the budget —
 * exactly the `/psych now` contract. Head is resolved before any spend, so a session outside a git
 * repository declines for free.
 */
export async function reviewObserver(
	state: DevsPsychologistState,
	ctx: ExtensionContext,
	deps: ReviewDeps,
	options: { force?: boolean } = {},
): Promise<ReviewOutcome> {
	const force = options.force === true;
	if (!state.config.enabled || !state.config.roles.reviewer.enabled) return { ran: false, reason: "disabled" };
	// The reviewer is agent-runtime only: it must read the diff with its own tools.
	if (state.config.runtime !== "agent") return { ran: false, reason: "runtime" };
	if (!ctx.hasUI) return { ran: false, reason: "headless" };
	const modelRef = reviewerModel(state);
	if (modelRef.trim().length === 0) return { ran: false, reason: "no_model" };

	const head = deps.resolveHead(ctx.cwd);
	if (head.length === 0) return { ran: false, reason: "no_git" };
	// Once per delivery: a head already reviewed is not reviewed again, though `/psych review` may.
	if (!force && head === state.reviewedHead) return { ran: false, reason: "already" };
	if (state.appraisalInFlight || state.appraisalPromise) return { ran: false, reason: "in_flight" };
	if (!state.budgetAvailable()) return { ran: false, reason: "budget" };
	const cap = state.config.agent.maxCostUsdPerSession;
	if (cap > 0 && state.agentSessionCostUsd >= cap) return { ran: false, reason: "cost" };

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
		const reviewer = state.config.roles.reviewer;
		const review: ReviewBrief = {
			lastDeliveryHead: state.reviewLastHead,
			head,
			maxDiffBytes: reviewer.maxDiffBytes,
			conventionFiles: reviewer.conventionFiles,
		};
		// Enforcement verifies citations against what the PLUGIN supplied: the session evidence lines
		// and the convention file paths. The diff is read by the child, so the parent cannot verify a
		// verbatim diff line; the brief therefore asks the child to cite supplied lines (a convention
		// path or a SESSION line) and to carry the rule text in `rule`.
		const lines = [...liveLines, ...sessionLines, ...reviewer.conventionFiles];

		const result = await deps.callModel(ctx.modelRegistry, {
			modelRef,
			// The reviewer's OWN model, when one is set: the API path ignores this (D2).
			...(reviewer.model.trim().length > 0 ? { modelRefOverride: reviewer.model.trim() } : {}),
			systemPrompt: REVIEW_SYSTEM_PROMPT,
			userText: buildReviewUserText(liveLines, sessionLines),
			maxTokens: REVIEW_MAX_TOKENS,
			signal: abort.signal,
			evidence: { liveLines, sessionLines },
			agentRole: "pair",
			agentContext: "evidence",
			review,
		});

		if (result.ok === false) return { ran: true, ok: false, stage: result.stage, error: result.error, head };
		state.lastAppraisalUsage = summarizeUsage(result.usage);

		const parsed = parseReview(result.text, lines);
		if (parsed.ok === false) return { ran: true, ok: false, stage: "parse", error: parsed.error, head };
		const enforced = parsed.review;
		const working = workingModel(ctx);
		const input: ReviewCardInput = {
			finding: enforced.finding,
			head,
			lastHead: state.reviewLastHead,
			unmatched: enforced.unmatched,
			// Same-model disclosure (ADR 0001 invariant 6): only when the session exposes its model and
			// the resolved reviewer model IS it.
			sameModel: working !== undefined && working === modelRef,
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
		return { ran: true, ok: true, review: enforced, head };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { ran: true, ok: false, stage: "request", error: message, head };
	} finally {
		// Updated on success AND failure, so consecutive commits review the range since this review
		// rather than re-reading the same head (T32a).
		state.reviewLastHead = head;
		state.reviewedHead = head;
		state.appraisalInFlight = false;
		if (state.appraisalAbort === abort) state.appraisalAbort = undefined;
		ctxSignal?.removeEventListener?.("abort", forwardAbort);
		stopResearchingChip(state);
		state.ifLive(() => paintChip(state, ctx));
	}
}

/**
 * The automatic trigger's entry point (T32a), wired by the composition root into the observer.
 *
 * Fire-and-forget: a review takes tens of seconds, so the delivery event must not block on it. The
 * single-flight flags are the gate, so a burst of boundaries starts at most one run.
 */
export function runReviewTrigger(state: DevsPsychologistState, ctx: ExtensionContext, deps: ReviewDeps): void {
	if (state.appraisalInFlight || state.appraisalPromise) return;
	void reviewObserver(state, ctx, deps).catch(() => {});
}

/**
 * Wrap `reviewObserver` as the `/psych review` handler: it maps a skip or failure onto the one
 * status line `/psych` notifies, and returns `""` on success (the finding was shown as a card or as
 * the notification fallback).
 */
export function reviewCommandHandler(
	state: DevsPsychologistState,
	deps: ReviewDeps,
): (ctx: ExtensionCommandContext) => Promise<string> {
	return async (ctx) => {
		const s = stringsFor(state.config.lang);
		const outcome = await reviewObserver(state, ctx, deps, { force: true });
		if (outcome.ran === false) {
			switch (outcome.reason) {
				case "disabled":
					return s.reviewDisabled;
				case "runtime":
					return s.reviewNeedsAgent;
				case "no_model":
					return s.reportNoModel;
				case "no_git":
					return s.reviewNoGit;
				case "headless":
					return s.notTui;
				case "in_flight":
					return s.busy;
				case "budget":
					return s.reportBudget(state.appraisalsThisSession, String(state.config.maxAppraisalsPerSession));
				case "cost":
					return s.reportCostCap;
				default:
					return "";
			}
		}
		if (outcome.ok === false) return `${s.reportErr} — ${outcome.stage}: ${outcome.error}`;
		return "";
	};
}
