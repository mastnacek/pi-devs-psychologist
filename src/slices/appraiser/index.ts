/**
 * appraiser — the policy that decides when the psychologist is asked, and the delivery of
 * whatever it says.
 *
 * Three rules make this the plugin's cost boundary, and all three are attempts-based rather
 * than successes-based:
 *
 * - **The budget counts attempts.** A call that fails may still have been billed, so
 *   counting only successes would let a broken model spend without limit.
 * - **The cadence resets on an attempt too.** Otherwise a model that fails every time would
 *   be retried on every single turn, which is a spend loop rather than an observer.
 * - **Single-flight.** A slow model must not be asked twice because the next turn arrived
 *   while it was thinking.
 *
 * Every path returns a typed outcome naming why it did or did not run. "It didn't work" is
 * not a diagnosis; `{ ran: false, reason: "cadence" }` is.
 *
 * Dependencies are injected rather than imported by this slice: the model call, the history
 * read and the notification all come from the composition root. That is what lets the whole
 * policy be tested with a fake that counts calls, so "exactly three calls over thirty turns"
 * is an assertion rather than a hope.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { parseAppraisal, isSilent } from "../../shared/appraisal-enforce.js";
import type { Appraisal } from "../../shared/appraisal.js";
import {
	callModel,
	summarizeUsage,
	type ModelCallResult,
	type ModelCallStage,
} from "../../shared/model-call.js";
import { allowedEvidence, buildUserText, SYSTEM_PROMPT } from "../../shared/prompt.js";
import { extractSignals } from "../../shared/signals.js";
import { signalOptions, type DevsPsychologistState } from "../../shared/state.js";
import type { SessionHistory } from "../../shared/history.js";
import { paintChip } from "../../shared/status.js";
import type { DeliveryOutcome } from "../../shared/delivery.js";

/** An appraisal response is a small JSON object; the cap is a spend guard, not a need. */
export const APPRAISAL_MAX_TOKENS = 1200;

export type SkipReason =
	| "disabled"
	| "headless"
	| "no_model"
	| "in_flight"
	| "cadence"
	| "budget";

export type AppraiseOutcome =
	| { ran: false; reason: SkipReason }
	| {
			ran: true;
			ok: true;
			appraisal: Appraisal;
			silent: boolean;
			unmatched: string[];
			downgraded: string[];
			modelRef: string;
			/** How the intervention reached the operator, and whether the agent was told. */
			delivery: DeliveryOutcome;
	  }
	| { ran: true; ok: false; stage: ModelCallStage | "parse"; error: string };

export interface AppraiserDeps {
	/** Read the current session branch. Injected so the slice imports no other slice. */
	readHistory(ctx: ExtensionContext): SessionHistory;
	/** The one model call. Injected so tests can count and fake it. */
	callModel(
		registry: ExtensionContext["modelRegistry"],
		req: Parameters<typeof callModel>[1],
	): Promise<ModelCallResult>;
	/** Hand the intervention to a surface. Injected, so this slice knows no other slice. */
	deliver(
		pi: ExtensionAPI,
		state: DevsPsychologistState,
		ctx: ExtensionContext,
		appraisal: Appraisal,
	): Promise<DeliveryOutcome>;
}

/** The real dependencies. Called only from the composition root. */
export function defaultDeps(
	readHistory: AppraiserDeps["readHistory"],
	deliver: AppraiserDeps["deliver"],
): AppraiserDeps {
	return {
		readHistory,
		callModel: (registry, req) => callModel(registry, req),
		deliver,
	};
}

function describe(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * Decide whether to appraise now, and do it.
 *
 * Runs on `turn_end`, but never assumes it is the only thing happening: the flag is set
 * before any await and cleared in a `finally`.
 */
export async function maybeAppraise(
	pi: ExtensionAPI,
	state: DevsPsychologistState,
	ctx: ExtensionContext,
	deps: AppraiserDeps,
	options: { force?: boolean } = {},
	): Promise<AppraiseOutcome> {
	const force = options.force === true;
	if (!state.config.enabled) return { ran: false, reason: "disabled" };
	// No human to read it, and this is the plugin's only spend. json/print modes have no UI,
	// so an appraisal there would cost money for a report nobody can see.
	if (!ctx.hasUI) return { ran: false, reason: "headless" };
	if (state.config.model.trim().length === 0) return { ran: false, reason: "no_model" };
	if (state.appraisalInFlight) return { ran: false, reason: "in_flight" };
	// `force` is the operator asking explicitly (`/psych now`), which is a different question
	// from the cadence. It never bypasses the budget: a hard ceiling is a hard ceiling, and
	// silently exceeding it on request would make the number meaningless.
	if (!force && state.turnsSinceAppraisal < state.config.cadenceTurns) {
		return { ran: false, reason: "cadence" };
	}
	if (!state.budgetAvailable()) return { ran: false, reason: "budget" };

	state.appraisalInFlight = true;
	// Counted before the call, and the cadence restarts here: both are about *attempts*.
	state.appraisalsThisSession += 1;
	state.turnsSinceAppraisal = 0;

	try {
		const signals = extractSignals(state.observations, signalOptions(state));
		const history = deps.readHistory(ctx);
		const lines = allowedEvidence(signals.evidence, history.evidence);
		const modelRef = state.config.model;

		const result = await deps.callModel(ctx.modelRegistry, {
			modelRef,
			systemPrompt: SYSTEM_PROMPT,
			userText: buildUserText(signals.evidence, history.evidence),
			maxTokens: APPRAISAL_MAX_TOKENS,
			// No temperature and no reasoning overrides: an observer must not request sampling
			// settings a provider may reject. The call's job is to be boringly repeatable.
			signal: ctx.signal,
		});

		// `=== false` rather than `!result.ok`: truthiness narrowing is not reliable under
		// `strict: false`, and a union that silently fails to narrow is a type check that
		// reads as passing while proving nothing.
		if (result.ok === false) {
			state.lastAppraisalFailure = { stage: result.stage, error: result.error };
			return { ran: true, ok: false, stage: result.stage, error: result.error };
		}

		// The engine cannot be told about this call, so the plugin keeps its own figures.
		state.lastAppraisalUsage = summarizeUsage(result.usage);

		const parsed = parseAppraisal(result.text, lines);
		if (parsed.ok === false) {
			state.lastAppraisalFailure = { stage: "parse", error: parsed.error };
			return { ran: true, ok: false, stage: "parse", error: parsed.error };
		}

		state.lastAppraisal = parsed.appraisal;
		state.lastAppraisalAt = Date.now();
		state.lastAppraisalNotes = { unmatched: parsed.unmatched, downgraded: parsed.downgraded };
		state.lastAppraisalFailure = undefined;

		const silent = isSilent(parsed.appraisal);
		// The slice itself never touches a surface. It hands the appraisal to the injected
		// delivery policy, which decides between the card, a notification, steering the working
		// agent, or nothing at all.
		let delivery: DeliveryOutcome = { human: "none", agent: false, reason: "silent" };
		try {
			delivery = await deps.deliver(pi, state, ctx, parsed.appraisal);
		} catch {
			// A delivery failure must not fail the turn: the appraisal is already stored.
		}

		return {
			ran: true,
			ok: true,
			appraisal: parsed.appraisal,
			silent,
			unmatched: parsed.unmatched,
			downgraded: parsed.downgraded,
			modelRef,
			delivery,
		};
	} catch (error) {
		const message = describe(error);
		state.lastAppraisalFailure = { stage: "request", error: message };
		return { ran: true, ok: false, stage: "request", error: message };
	} finally {
		state.appraisalInFlight = false;
		state.ifLive(() => paintChip(state, ctx));
	}
}

/** Subscribe the appraiser. The subscription is tracked so shutdown can drain it. */
export function registerAppraiser(
	pi: ExtensionAPI,
	state: DevsPsychologistState,
	deps: AppraiserDeps,
): void {
	state.track(
		pi.on("turn_end", async (_event, ctx) => {
			await maybeAppraise(pi, state, ctx, deps);
		}),
	);
}