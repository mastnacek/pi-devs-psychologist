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
import { parseAppraisal, isSilent, type SourcePolicy } from "../../shared/appraisal-enforce.js";
import type { Appraisal } from "../../shared/appraisal.js";
import {
	callModel,
	summarizeUsage,
	type AgentCallStage,
	type ModelCallResult,
	type ModelCallStage,
} from "../../shared/model-call.js";
import { allowedEvidence, buildUserText, SYSTEM_PROMPT } from "../../shared/prompt.js";
import { environmentEvidence } from "../../shared/environment.js";
import { extractSignals, type SessionSignals } from "../../shared/signals.js";
import {
	coolingKinds,
	doNotRepeatLines,
	mutedKinds,
	resolveDueOutcomes,
	snapshotOutcome,
	type OutcomeChannel,
	type OutcomeRecord,
} from "../../shared/outcome.js";
import { evaluateTriggers, snapshotTriggers, type TriggerReason } from "../../shared/triggers.js";
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
	| "no_trigger"
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
	| { ran: true; ok: false; stage: ModelCallStage | AgentCallStage | "parse"; error: string };

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
		options?: { evenIfSilent?: boolean },
	): Promise<DeliveryOutcome>;
	/**
	 * What a suggestion's `source` may be, for this machine (T25). Injected because the docs
	 * directory is resolved by the composition root and the notebook ids live in the config; this
	 * slice must not import either. Absent means "no docs dir, no notebooks".
	 */
	sourcePolicy?(): SourcePolicy;
}

/** The real dependencies. Called only from the composition root. */
export function defaultDeps(
	readHistory: AppraiserDeps["readHistory"],
	deliver: AppraiserDeps["deliver"],
	/** The runtime choice, injected by the composition root (T24). Defaults to today's API call. */
	callModelImpl: AppraiserDeps["callModel"] = (registry, req) => callModel(registry, req),
	/** The suggestion source policy (T25); absent means only URLs and install specs are valid. */
	sourcePolicy?: AppraiserDeps["sourcePolicy"],
): AppraiserDeps {
	// `callModel` is the seam: the appraiser never learns which runtime ran, and the API call is the
	// default (D1). The composition root swaps in the agent runner and branches on `state.config.runtime`.
	return { readHistory, callModel: callModelImpl, deliver, sourcePolicy };
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

	try {
		const signals = extractSignals(state.observations, signalOptions(state));
		const history = deps.readHistory(ctx);

		// The trigger gate (D7). Under `signals` the model runs only when the evidence carries
		// something new since the last attempt; `force` (the operator asked) bypasses it, and
		// `cadence` mode skips the gate entirely and behaves exactly as the old clock did.
		let firedReasons: TriggerReason[] = [];
		if (!force && state.config.trigger === "signals") {
			const evaluated = evaluateTriggers(
				{ signals, history },
				state.triggerBaseline,
				state.config.triggerThresholds,
			);
			if (!evaluated.fire) {
				state.appraisalsSkipped += 1;
				return { ran: false, reason: "no_trigger" };
			}
			firedReasons = evaluated.reasons;
			state.lastTriggerReasons = firedReasons;
		}

		// Counted before the call, and the cadence restarts here: both are about *attempts*.
		state.appraisalsThisSession += 1;
		state.turnsSinceAppraisal = 0;
		// Baseline on EVERY attempt (a forced one included), so the evidence that caused this
		// appraisal cannot cause the next one.
		state.triggerBaseline = snapshotTriggers({ signals, history });

		// The environment lines join the SESSION block, not the LIVE one: they describe the
		// machine the session ran on, not the window that just elapsed, and mixing the two
		// would let the model read a stale flag as a fresh observation.
		const sessionLines = [
			...history.evidence,
			...(state.config.envFacts ? environmentEvidence({ cwd: ctx.cwd }) : []),
		];
		// One LIVE line per cooling/muted kind (T17), so the model is never asked to repeat advice this
		// session already proved useless. It joins `signals.evidence`, so it reaches the prompt AND
		// `allowedEvidence` through the same `liveLines` list — the two must stay identical sets.
		const coolingLines = doNotRepeatLines(state.outcomes, state.turnCount, state.config.cooldownTurns);
		// One LIVE line naming what fired, so the reason for the appraisal is itself citable
		// evidence. It is added to the live block, so it reaches both the prompt and enforcement.
		const liveLines = [
			...signals.evidence,
			...(firedReasons.length > 0 ? [`appraisal triggered by: ${firedReasons.join(", ")}`] : []),
			...coolingLines,
		];
		// `allowedEvidence` is what enforcement matches citations against, so the environment
		// lines must be in BOTH: offered to the model and admissible as proof. Adding them to
		// only one of the two produces the worst possible failure — a verdict the model was
		// told to make and is then punished for making.
		const lines = allowedEvidence(liveLines, sessionLines);
		const modelRef = state.config.model;

		const result = await deps.callModel(ctx.modelRegistry, {
			modelRef,
			systemPrompt: SYSTEM_PROMPT,
			userText: buildUserText(liveLines, sessionLines),
			maxTokens: APPRAISAL_MAX_TOKENS,
			// No temperature and no reasoning overrides: an observer must not request sampling
			// settings a provider may reject. The call's job is to be boringly repeatable.
			signal: ctx.signal,
			// The agent runtime (T24) needs the evidence lines apart from `userText` to rebuild the
			// child's message via `buildAgentBrief` (D2). The API path ignores this field entirely, so
			// the bytes it sends are unchanged: `userText` remains authoritative there.
			evidence: { liveLines, sessionLines },
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

		const parsed = parseAppraisal(result.text, lines, deps.sourcePolicy?.());
		if (parsed.ok === false) {
			state.lastAppraisalFailure = { stage: "parse", error: parsed.error };
			return { ran: true, ok: false, stage: "parse", error: parsed.error };
		}

		// Anti-nag (T17): a kind still cooling (delivered < cooldownTurns ago) or muted (tried twice
		// with no improvement) is dropped before delivery. The prompt already warned the model off it;
		// this is the enforcement for when it ignores the warning. The VERDICTS are kept — only the
		// repeat advice is refused — and the drop is recorded so `/psych` can show the restraint.
		const candidate = parsed.appraisal.interventions[0];
		const refused =
			candidate !== undefined &&
			(mutedKinds(state.outcomes).has(candidate.kind) ||
				coolingKinds(state.outcomes, state.turnCount, state.config.cooldownTurns).has(candidate.kind));
		if (refused) {
			parsed.appraisal.interventions = [];
			parsed.downgraded.push("cooldown");
		}

		state.lastAppraisal = parsed.appraisal;
		state.lastAppraisalAt = Date.now();
		state.lastAppraisalNotes = { unmatched: parsed.unmatched, downgraded: parsed.downgraded };
		state.lastAppraisalFailure = undefined;
		// Minimal T7: the appraisal is a TUI-only entry, so `/reload` keeps the report while the
		// judgement never re-enters model context or the observation window.
		pi.appendEntry("psych-appraisal", parsed.appraisal);

		const silent = isSilent(parsed.appraisal);
		// The slice itself never touches a surface. It hands the appraisal to the injected
		// delivery policy, which decides between the card, a notification, steering the working
		// agent, or nothing at all.
		let delivery: DeliveryOutcome = { human: "none", agent: false, reason: "silent" };
		const cardOpenedAt = Date.now();
		try {
			// `force` means the operator asked, so the analysis is shown even when it has no advice
			// to give. An automatic appraisal keeps its silence.
			delivery = await deps.deliver(pi, state, ctx, parsed.appraisal, { evenIfSilent: force });
		} catch {
			// A delivery failure must not fail the turn: the appraisal is already stored.
		}
		// Outcome ledger (T16): record only a delivery the operator actually saw. The window's
		// `before` snapshot is the one computed for this turn, so the verdict cannot drift from the
		// evidence the model read.
		recordDelivery(pi, state, signals, history, parsed.appraisal.interventions[0], delivery, cardOpenedAt);

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

/** A unique id for a ledger record. `randomUUID` where available; a time+counter fallback otherwise. */
function nextOutcomeId(): string {
	const api = globalThis.crypto as { randomUUID?: () => string } | undefined;
	if (typeof api?.randomUUID === "function") return api.randomUUID();
	return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Record a delivered intervention in the ledger and persist it as a TUI-only entry (T16).
 *
 * Only a delivery the operator actually saw is recorded: a silent appraisal, or one whose
 * intervention T17 dropped, wrote nothing to measure. The channel names the surface, and the
 * card's open duration is measured around the `deliver` await the caller wrapped.
 */
function recordDelivery(
	pi: ExtensionAPI,
	state: DevsPsychologistState,
	signals: SessionSignals,
	history: SessionHistory,
	intervention: Appraisal["interventions"][number] | undefined,
	delivery: DeliveryOutcome,
	cardOpenedAt: number,
): void {
	if (!intervention) return;
	const channel: OutcomeChannel | undefined =
		delivery.human === "card"
			? "card"
			: delivery.human === "notification"
				? "notification"
				: delivery.agent
					? "steer"
					: undefined;
	if (!channel) return;
	const record: OutcomeRecord = {
		id: nextOutcomeId(),
		kind: intervention.kind,
		deliveredAtTurn: state.turnCount,
		channel,
		before: snapshotOutcome({ signals, history }),
		text: intervention.text,
		...(channel === "card" ? { closedCardMs: Math.max(0, Date.now() - cardOpenedAt) } : {}),
	};
	state.outcomes.push(record);
	pi.appendEntry("psych-outcome", record);
}

/**
 * Close every outcome window whose `outcomeWindowTurns` have elapsed (T16).
 *
 * Runs on every turn (regardless of whether an appraisal ran), recomputing the session snapshot
 * once and applying it to every due record. A record that just closed is persisted as its own
 * follow-up entry, so a reload reconstructs the verdict.
 */
export function settleOutcomes(
	pi: ExtensionAPI,
	state: DevsPsychologistState,
	ctx: ExtensionContext,
	deps: AppraiserDeps,
): void {
	if (state.outcomes.length === 0) return;
	const signals = extractSignals(state.observations, signalOptions(state));
	const snapshot = snapshotOutcome({ signals, history: deps.readHistory(ctx) });
	for (const record of resolveDueOutcomes(
		state.outcomes,
		state.turnCount,
		state.config.outcomeWindowTurns,
		snapshot,
	)) {
		pi.appendEntry("psych-outcome", record);
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
			// Outcome windows close on the same event, so a record proves itself even on a turn the
			// trigger rule skipped the model entirely.
			settleOutcomes(pi, state, ctx, deps);
		}),
	);
}